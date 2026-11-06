import { randomUUID } from "node:crypto";
import { and, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import {
  canvasEdges,
  canvasNodes,
  canvases,
} from "../../infrastructure/db/schema.js";
import {
  collectDownstreamNodeIds,
  diffIds,
  inferAutoEdges,
  subtractEdges,
} from "./canvas-graph.js";
import type {
  CanvasCreateInput,
  CanvasCreateOutput,
  CanvasListInput,
  CanvasListOutput,
  CanvasSaveInput,
  CanvasSnapshotOutput,
} from "@vimax/contracts";

// ── Create ─────────────────────────────────────────────────────────

export async function createCanvas(
  input: CanvasCreateInput,
  tenantId = "default",
): Promise<CanvasCreateOutput> {
  const db = getDb();
  const [canvas] = await db
    .insert(canvases)
    .values({
      tenantId,
      name: input.name,
      viewport: { x: 0, y: 0, zoom: 1 },
    })
    .returning({ id: canvases.id });

  return { canvas_id: canvas!.id };
}

// ── List ───────────────────────────────────────────────────────────

export async function listCanvases(
  input: CanvasListInput,
  tenantId = "default",
): Promise<CanvasListOutput> {
  const db = getDb();
  const limit = input.limit ?? 20;

  // Build cursor condition
  const conditions = [eq(canvases.tenantId, tenantId)];
  if (input.cursor) {
    const [cursorCanvas] = await db
      .select({ updatedAt: canvases.updatedAt })
      .from(canvases)
      .where(eq(canvases.id, input.cursor))
      .limit(1);
    if (cursorCanvas) {
      conditions.push(lt(canvases.updatedAt, cursorCanvas.updatedAt));
    }
  }

  const rows = await db
    .select({
      id: canvases.id,
      name: canvases.name,
      updatedAt: canvases.updatedAt,
    })
    .from(canvases)
    .where(and(...conditions))
    .orderBy(desc(canvases.updatedAt))
    .limit(limit + 1);

  const page = rows.slice(0, limit);

  // Get node counts in one query
  const items = await Promise.all(
    page.map(async (row) => {
      const [result] = await db
        .select({ cnt: count() })
        .from(canvasNodes)
        .where(eq(canvasNodes.canvasId, row.id));
      return {
        canvas_id: row.id,
        name: row.name,
        node_count: result?.cnt ?? 0,
        updated_at: row.updatedAt.toISOString(),
      };
    }),
  );

  return {
    items,
    nextCursor: rows.length > limit ? rows[limit]?.id : undefined,
  };
}

// ── Snapshot (full state load) ─────────────────────────────────────

export async function getCanvasSnapshot(
  canvasId: string,
): Promise<CanvasSnapshotOutput | null> {
  const db = getDb();

  const [canvas] = await db
    .select()
    .from(canvases)
    .where(eq(canvases.id, canvasId))
    .limit(1);

  if (!canvas) return null;

  const nodes = await db
    .select()
    .from(canvasNodes)
    .where(eq(canvasNodes.canvasId, canvasId));

  const edges = await db
    .select()
    .from(canvasEdges)
    .where(eq(canvasEdges.canvasId, canvasId));
  const snapshotUpdatedAt = Math.max(
    canvas.updatedAt.getTime(),
    ...nodes.map((node) => node.updatedAt.getTime()),
    ...edges.map((edge) => edge.createdAt.getTime()),
  );

  return {
    canvas: {
      id: canvas.id,
      tenant_id: canvas.tenantId,
      name: canvas.name,
      viewport: canvas.viewport as { x: number; y: number; zoom: number },
      created_at: canvas.createdAt.toISOString(),
      updated_at: new Date(snapshotUpdatedAt).toISOString(),
    },
    nodes: nodes.map((n) => ({
      id: n.id,
      canvas_id: n.canvasId,
      type: n.type,
      position: n.position as { x: number; y: number },
      data: n.data as Record<string, unknown>,
      output_asset_id: n.outputAssetId,
      status: n.status,
      created_at: n.createdAt.toISOString(),
      updated_at: n.updatedAt.toISOString(),
    })),
    edges: edges.map((e) => ({
      id: e.id,
      canvas_id: e.canvasId,
      source_node_id: e.sourceNodeId,
      target_node_id: e.targetNodeId,
      source_handle: e.sourceHandle,
      target_handle: e.targetHandle,
      created_at: e.createdAt.toISOString(),
    })),
  };
}

// ── Save (incremental upsert of nodes + edges) ────────────────────
//
// Preserves each node's runtime `status` and `output_asset_id`: only the
// structural fields (`type`, `position`, `data`) are overwritten on
// conflict. A full replace here would wipe every generated result the
// moment a user drags a node — which is why this is an upsert.

export async function saveCanvas(input: CanvasSaveInput): Promise<{ ok: true; updated_at: string }> {
  const db = getDb();

  // Postgres rejects ON CONFLICT DO UPDATE when one command carries the same
  // key twice, so collapse duplicate ids first (last occurrence = latest
  // client state wins).
  const nodesById = new Map(input.nodes.map((n) => [n.id, n]));
  const edgesById = new Map(input.edges.map((e) => [e.id, e]));
  const nodes = [...nodesById.values()];
  const edges = [...edgesById.values()];

  const updatedAt = await db.transaction(async (tx) => {
    const incomingNodeIdList = nodes.map((node) => node.id);
    const incomingEdgeIdList = edges.map((edge) => edge.id);
    const [nodeCollision, edgeCollision] = await Promise.all([
      incomingNodeIdList.length
        ? tx.select({ id: canvasNodes.id }).from(canvasNodes)
            .where(and(inArray(canvasNodes.id, incomingNodeIdList), sql`${canvasNodes.canvasId} != ${input.canvas_id}`)).limit(1)
        : Promise.resolve([]),
      incomingEdgeIdList.length
        ? tx.select({ id: canvasEdges.id }).from(canvasEdges)
            .where(and(inArray(canvasEdges.id, incomingEdgeIdList), sql`${canvasEdges.canvasId} != ${input.canvas_id}`)).limit(1)
        : Promise.resolve([]),
    ]);
    if (nodeCollision.length || edgeCollision.length) {
      throw new Error("canvas.snapshot_contains_foreign_ids");
    }
    // 1. Snapshot current ids so we can compute what to delete.
    const existingNodes = await tx
      .select({ id: canvasNodes.id, updatedAt: canvasNodes.updatedAt })
      .from(canvasNodes)
      .where(eq(canvasNodes.canvasId, input.canvas_id));
    const existingEdges = await tx
      .select({ id: canvasEdges.id, createdAt: canvasEdges.createdAt })
      .from(canvasEdges)
      .where(eq(canvasEdges.canvasId, input.canvas_id));

    const snapshotTime = new Date(input.snapshot_updated_at);
    const incomingNodeIds = new Set(nodes.map((node) => node.id));
    const incomingEdgeIds = new Set(edges.map((edge) => edge.id));
    const deleteNodeIds = existingNodes
      .filter((node) => !incomingNodeIds.has(node.id) && node.updatedAt <= snapshotTime)
      .map((node) => node.id);
    const deleteEdgeIds = existingEdges
      .filter((edge) => !incomingEdgeIds.has(edge.id) && edge.createdAt <= snapshotTime)
      .map((edge) => edge.id);
    const deletedNodeIds = new Set(deleteNodeIds);
    const retainedNodeIds = new Set(existingNodes.map((node) => node.id).filter((id) => !deletedNodeIds.has(id)));
    for (const id of incomingNodeIds) retainedNodeIds.add(id);
    if (edges.some((edge) => !retainedNodeIds.has(edge.source_node_id) || !retainedNodeIds.has(edge.target_node_id))) {
      throw new Error("canvas.snapshot_contains_dangling_edges");
    }
    const newerNodeIds = new Set(existingNodes.filter((node) => node.updatedAt > snapshotTime).map((node) => node.id));
    const newerEdgeIds = new Set(existingEdges.filter((edge) => edge.createdAt > snapshotTime).map((edge) => edge.id));
    const nodesToUpsert = nodes.filter((node) => !newerNodeIds.has(node.id));
    const edgesToUpsert = edges.filter((edge) => !newerEdgeIds.has(edge.id));

    // 2. Remove dropped nodes (their edges cascade) and dropped edges.
    if (deleteNodeIds.length > 0) {
      await tx
        .delete(canvasNodes)
        .where(inArray(canvasNodes.id, deleteNodeIds));
    }
    if (deleteEdgeIds.length > 0) {
      await tx
        .delete(canvasEdges)
        .where(inArray(canvasEdges.id, deleteEdgeIds));
    }

    // 3. Upsert nodes — status & outputAssetId are intentionally NOT in
    //    the conflict set so existing results survive every save.
    if (nodesToUpsert.length > 0) {
      await tx
        .insert(canvasNodes)
        .values(
          nodesToUpsert.map((n) => ({
            id: n.id,
            canvasId: input.canvas_id,
            type: n.type,
            position: n.position,
            data: n.data,
          })),
        )
        .onConflictDoUpdate({
          target: canvasNodes.id,
          set: {
            type: sql`excluded.type`,
            position: sql`excluded.position`,
            data: sql`excluded.data`,
            updatedAt: sql`now()`,
          },
        });
    }

    // 4. Upsert edges (after nodes, to satisfy the FK on insert).
    if (edgesToUpsert.length > 0) {
      await tx
        .insert(canvasEdges)
        .values(
          edgesToUpsert.map((e) => ({
            id: e.id,
            canvasId: input.canvas_id,
            sourceNodeId: e.source_node_id,
            targetNodeId: e.target_node_id,
            sourceHandle: e.source_handle ?? null,
            targetHandle: e.target_handle ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: canvasEdges.id,
          set: {
            sourceNodeId: sql`excluded.source_node_id`,
            targetNodeId: sql`excluded.target_node_id`,
            sourceHandle: sql`excluded.source_handle`,
            targetHandle: sql`excluded.target_handle`,
          },
        });
    }

    // 5. Bump canvas updatedAt (and viewport if provided).
    const [updatedCanvas] = await tx
      .update(canvases)
      .set({
        ...(input.viewport ? { viewport: input.viewport } : {}),
        updatedAt: new Date(),
      })
      .where(eq(canvases.id, input.canvas_id))
      .returning({ updatedAt: canvases.updatedAt });

    if (!updatedCanvas) throw new Error("canvas.not_found");
    return updatedCanvas.updatedAt.toISOString();
  });

  return { ok: true, updated_at: updatedAt };
}

// ── Auto-wire (persist missing type-dependency edges) ─────────────

/**
 * Infer type-dependency edges across the WHOLE canvas and persist the ones
 * that don't exist yet. Called after the agent creates nodes so generated
 * content lands as a connected pipeline (script → storyboard → shot → …)
 * instead of scattered cards. Idempotent: existing edges are never touched.
 * Returns the created edges in `edges.add` mutation shape for broadcast.
 */
export async function autoWireCanvas(
  canvasId: string,
): Promise<
  Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle?: string;
    targetHandle?: string;
  }>
> {
  const db = getDb();
  const nodes = await db
    .select({ id: canvasNodes.id, type: canvasNodes.type })
    .from(canvasNodes)
    .where(eq(canvasNodes.canvasId, canvasId));
  const existing = await db
    .select({
      sourceNodeId: canvasEdges.sourceNodeId,
      targetNodeId: canvasEdges.targetNodeId,
      sourceHandle: canvasEdges.sourceHandle,
      targetHandle: canvasEdges.targetHandle,
    })
    .from(canvasEdges)
    .where(eq(canvasEdges.canvasId, canvasId));

  const inferred = inferAutoEdges(nodes, randomUUID, existing);
  const fresh = subtractEdges(inferred, existing);
  if (fresh.length === 0) return [];

  await db.insert(canvasEdges).values(
    fresh.map((e) => ({
      id: e.id,
      canvasId,
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
      sourceHandle: e.sourceHandle,
      targetHandle: e.targetHandle,
    })),
  );

  return fresh.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    sourceHandle: e.sourceHandle ?? undefined,
    targetHandle: e.targetHandle ?? undefined,
  }));
}

// ── Delete canvas ──────────────────────────────────────────────────

export async function deleteCanvas(
  canvasId: string,
): Promise<{ ok: true }> {
  const db = getDb();

  // FK cascades handle nodes + edges
  const [deleted] = await db
    .delete(canvases)
    .where(eq(canvases.id, canvasId))
    .returning({ id: canvases.id });

  if (!deleted) {
    throw new Error("canvas.not_found");
  }

  return { ok: true };
}

// ── Helper: get single node ─────────────────────────────────────────

export async function getCanvasNode(
  canvasId: string,
  nodeId: string,
) {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.canvasId, canvasId),
        eq(canvasNodes.id, nodeId),
      ),
    )
    .limit(1);
  return node ?? null;
}

// ── Helper: get upstream nodes via edges ────────────────────────────

export async function getUpstreamNodes(
  canvasId: string,
  nodeId: string,
) {
  const db = getDb();

  // Find all edges where this node is the target
  const incomingEdges = await db
    .select()
    .from(canvasEdges)
    .where(
      and(
        eq(canvasEdges.canvasId, canvasId),
        eq(canvasEdges.targetNodeId, nodeId),
      ),
    );

  if (incomingEdges.length === 0) return [];

  const upstreamIds = incomingEdges.map((e) => e.sourceNodeId);

  const upstreamNodes = await db
    .select()
    .from(canvasNodes)
    .where(
      and(
        eq(canvasNodes.canvasId, canvasId),
        // We need IN clause — Drizzle supports this via `inArray` but
        // let's query one at a time for simplicity since fan-out is small
      ),
    );

  // Filter to only upstream nodes
  const nodeMap = new Map(upstreamNodes.map((n) => [n.id, n]));
  return incomingEdges.map((edge) => {
    const sourceNode = nodeMap.get(edge.sourceNodeId);
    return {
      edge,
      sourceNode: sourceNode ?? null,
    };
  });
}

// ── Helper: mark node status ────────────────────────────────────────

export async function setNodeStatus(
  canvasId: string,
  nodeId: string,
  status: "idle" | "running" | "done" | "dirty" | "failed",
  outputAssetId?: string | null,
) {
  const db = getDb();
  const updateData: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };
  if (outputAssetId !== undefined) {
    updateData.outputAssetId = outputAssetId;
  }
  await db
    .update(canvasNodes)
    .set(updateData)
    .where(
      and(
        eq(canvasNodes.canvasId, canvasId),
        eq(canvasNodes.id, nodeId),
      ),
    );
}

// ── Helper: mark downstream nodes dirty ─────────────────────────────
//
// When a node's output changes, every result that depended on it is
// stale. Only `done` nodes are flipped to `dirty` — an `idle` node had
// no result to invalidate, and a `running`/`failed` node keeps its state.

export async function markDownstreamDirty(
  canvasId: string,
  nodeId: string,
): Promise<void> {
  const db = getDb();

  const edges = await db
    .select({
      sourceNodeId: canvasEdges.sourceNodeId,
      targetNodeId: canvasEdges.targetNodeId,
    })
    .from(canvasEdges)
    .where(eq(canvasEdges.canvasId, canvasId));

  const downstreamIds = collectDownstreamNodeIds(
    edges.map((e) => ({
      sourceNodeId: e.sourceNodeId,
      targetNodeId: e.targetNodeId,
    })),
    nodeId,
  );

  if (downstreamIds.length === 0) return;

  await db
    .update(canvasNodes)
    .set({ status: "dirty", updatedAt: new Date() })
    .where(
      and(
        eq(canvasNodes.canvasId, canvasId),
        inArray(canvasNodes.id, downstreamIds),
        eq(canvasNodes.status, "done"),
      ),
    );
}

// ── Helper: update a single data field on a node ───────────────────

export async function updateNodeDataField(
  canvasId: string,
  nodeId: string,
  key: string,
  value: unknown,
) {
  const db = getDb();
  const [node] = await db
    .select({ data: canvasNodes.data })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node) return;

  const currentData = (node.data as Record<string, unknown>) ?? {};
  await db
    .update(canvasNodes)
    .set({ data: { ...currentData, [key]: value }, updatedAt: new Date() })
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)));
}
