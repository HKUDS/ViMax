import { randomUUID } from "crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Script2StoryboardCell } from "@vimax/contracts";
import { getDb } from "../../infrastructure/db/client.js";
import { canvasEdges, canvasNodes, canvases } from "../../infrastructure/db/schema.js";
import { broadcastToRoom } from "../../realtime/connection-manager.js";
import { collectDownstreamNodeIds } from "./canvas-graph.js";

export const STORYBOARD_ZONE = { x: 720, y: 60 };
export const STORYBOARD_ROW_HEIGHT = 240;

export interface SpawnedStoryboardNode {
  id: string;
  type: "storyboard_cell";
  position: { x: number; y: number };
  data: {
    shotBrief: string;
    cameraIdx: number;
    audioDesc: string;
    status: "idle";
  };
}

export interface SpawnedStoryboardEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: null;
  targetHandle: null;
}

export function buildStoryboardSpawnGraph(
  scriptNodeId: string,
  cells: Script2StoryboardCell[],
): { nodes: SpawnedStoryboardNode[]; edges: SpawnedStoryboardEdge[] } {
  const nodes: SpawnedStoryboardNode[] = [];
  const edges: SpawnedStoryboardEdge[] = [];

  cells.forEach((cell, index) => {
    const nodeId = randomUUID();
    nodes.push({
      id: nodeId,
      type: "storyboard_cell",
      position: {
        x: STORYBOARD_ZONE.x,
        y: STORYBOARD_ZONE.y + index * STORYBOARD_ROW_HEIGHT,
      },
      data: {
        shotBrief: cell.shotBrief,
        cameraIdx: cell.cameraIdx,
        audioDesc: cell.audioDesc ?? "",
        status: "idle",
      },
    });
    edges.push({
      id: randomUUID(),
      sourceNodeId: scriptNodeId,
      targetNodeId: nodeId,
      sourceHandle: null,
      targetHandle: null,
    });
  });

  return { nodes, edges };
}

/**
 * 分镜重跑幂等：script2storyboard 每次完成都会 INSERT 新 cell，旧链不清
 * 就翻倍堆积（cell→shot→image→video），多出来的节点还会被自动连线跨链
 * 错接。删除该 script 的旧 storyboard_cell 及其全部下游，edges 随端点
 * 级联删除。返回被删除的节点 id（空数组 = 首次运行）。
 */
export async function clearScriptStoryboardChain(
  canvasId: string,
  scriptNodeId: string,
): Promise<string[]> {
  const db = getDb();
  const cells = await db
    .select({ id: canvasNodes.id })
    .from(canvasNodes)
    .innerJoin(canvasEdges, eq(canvasEdges.targetNodeId, canvasNodes.id))
    .where(
      and(
        eq(canvasNodes.canvasId, canvasId),
        eq(canvasNodes.type, "storyboard_cell"),
        eq(canvasEdges.sourceNodeId, scriptNodeId),
      ),
    );
  if (cells.length === 0) return [];

  const edges = await db
    .select({
      sourceNodeId: canvasEdges.sourceNodeId,
      targetNodeId: canvasEdges.targetNodeId,
    })
    .from(canvasEdges)
    .where(eq(canvasEdges.canvasId, canvasId));

  const removedIds = new Set<string>(cells.map((c) => c.id));
  for (const cell of cells) {
    for (const id of collectDownstreamNodeIds(edges, cell.id)) removedIds.add(id);
  }
  const ids = [...removedIds];
  await db
    .delete(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), inArray(canvasNodes.id, ids)));
  await db.update(canvases).set({ updatedAt: new Date() }).where(eq(canvases.id, canvasId));
  broadcastToRoom(canvasId, { type: "canvas.nodes_removed", canvasId, nodeIds: ids });
  return ids;
}

export async function persistStoryboardSpawn(
  canvasId: string,
  scriptNodeId: string,
  cells: Script2StoryboardCell[],
): Promise<string[]> {
  if (cells.length === 0) return [];

  const { nodes, edges } = buildStoryboardSpawnGraph(scriptNodeId, cells);
  const db = getDb();

  await db.insert(canvasNodes).values(
    nodes.map((node) => ({
      id: node.id,
      canvasId,
      type: node.type,
      position: node.position,
      data: node.data,
      status: "idle" as const,
    })),
  );

  await db.insert(canvasEdges).values(
    edges.map((edge) => ({
      id: edge.id,
      canvasId,
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  );

  return nodes.map((node) => node.id);
}
