// ── Agent result application (job completion → canvas mutations) ────
//
// The Python agent bridges return JSON `result` payloads (characters,
// scripts, selections, trees, portraits). This module is the single place
// that maps each bridge's result onto canvas state, mirroring what the
// binary-asset completion branch does for image/video jobs.

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { CanvasNodeType } from "@vimax/contracts";
import { getDb } from "../../infrastructure/db/client.js";
import { assets, canvasEdges, canvasNodes } from "../../infrastructure/db/schema.js";
import { markDownstreamDirty, setNodeStatus, updateNodeDataField } from "./canvas.service.js";
import { broadcastNodeStatus } from "./node-status.js";
import { runReadyDirtyChildren } from "./node-executor.service.js";
import type { VariantEntry } from "./variations.js";

// ── Result payload shapes (mirrors vimax_bridge return values) ─────

export interface AgentCharacter {
  name: string;
  description: string;
}

export interface AgentScene {
  idx: number;
  script: string;
}

export interface CharacterInEvent {
  index: number;
  identifier_in_event: string;
  active_scenes?: Record<string, string>;
}

export interface PortraitAssetMeta {
  storage_key: string;
  width?: number;
  height?: number;
  sha256?: string;
  mime_type?: string;
  size_bytes?: number;
}

// ── Pure helpers (unit-testable) ────────────────────────────────────

export function normalizeAgentCharacters(value: unknown): AgentCharacter[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item?.name === "string" && item.name.trim().length > 0)
    .map((item) => ({
      name: (item.name as string).trim(),
      description:
        firstNonEmpty(item.description, item.static_features) ?? "",
    }));
}

function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return undefined;
}

export function normalizeAgentScenes(value: unknown): AgentScene[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as Record<string, unknown>)
    .filter((item) => typeof item?.script === "string" && item.script.trim().length > 0)
    .map((item, index) => ({
      idx: typeof item.idx === "number" ? item.idx : index,
      script: item.script as string,
    }));
}

/** Pick the gallery entry chosen by BestImageSelector (by entry index). */
export function pickBestVariant(
  variants: VariantEntry[] | undefined,
  bestIndex: number,
): VariantEntry | undefined {
  if (!variants || variants.length === 0) return undefined;
  return (
    variants.find((entry) => entry.index === bestIndex) ??
    variants[Math.min(bestIndex, variants.length - 1)]
  );
}

// ── Spawn graph builders ────────────────────────────────────────────

const CHARACTER_ZONE_OFFSET = { x: -360, y: 0 };
const CHARACTER_ROW_HEIGHT = 180;
const SCENE_ROW_HEIGHT = 220;

interface SpawnNode {
  id: string;
  type: CanvasNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

interface SpawnEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
}

export function buildCharacterSpawnGraph(
  sourceNodeId: string,
  sourcePosition: { x: number; y: number },
  characters: AgentCharacter[],
): { nodes: SpawnNode[]; edges: SpawnEdge[]; characterIds: string[] } {
  const nodes: SpawnNode[] = [];
  const edges: SpawnEdge[] = [];
  const characterIds: string[] = [];

  characters.forEach((character, index) => {
    const nodeId = randomUUID();
    characterIds.push(nodeId);
    nodes.push({
      id: nodeId,
      type: "character",
      position: {
        x: sourcePosition.x + CHARACTER_ZONE_OFFSET.x,
        y: sourcePosition.y + index * CHARACTER_ROW_HEIGHT,
      },
      data: {
        name: character.name,
        description: character.description,
        status: "idle",
      },
    });
    edges.push({
      id: randomUUID(),
      sourceNodeId: nodeId,
      targetNodeId: sourceNodeId,
      sourceHandle: null,
      targetHandle: null,
    });
  });

  return { nodes, edges, characterIds };
}

export function buildSceneSpawnGraph(
  sourceNodeId: string,
  sourcePosition: { x: number; y: number },
  scenes: AgentScene[],
): { nodes: SpawnNode[]; edges: SpawnEdge[] } {
  const nodes: SpawnNode[] = [];
  const edges: SpawnEdge[] = [];

  scenes.forEach((scene, index) => {
    const nodeId = randomUUID();
    nodes.push({
      id: nodeId,
      type: "script",
      position: {
        x: sourcePosition.x,
        y: sourcePosition.y + SCENE_ROW_HEIGHT * (index + 1),
      },
      data: {
        content: scene.script,
        sceneIdx: scene.idx,
        status: "idle",
      },
    });
    edges.push({
      id: randomUUID(),
      sourceNodeId,
      targetNodeId: nodeId,
      sourceHandle: null,
      targetHandle: null,
    });
  });

  return { nodes, edges };
}

// ── DB application ──────────────────────────────────────────────────

async function insertSpawnGraph(
  canvasId: string,
  nodes: SpawnNode[],
  edges: SpawnEdge[],
): Promise<string[]> {
  if (nodes.length === 0) return [];
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
  const validEdges = edges.filter((edge) => edge.sourceNodeId && edge.targetNodeId);
  if (validEdges.length > 0) {
    await db.insert(canvasEdges).values(
      validEdges.map((edge) => ({
        id: edge.id,
        canvasId,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
      })),
    );
  }
  return nodes.map((node) => node.id);
}

async function createAssetFromMeta(meta: PortraitAssetMeta): Promise<string> {
  const db = getDb();
  const [existing] = await db
    .select({ id: assets.id })
    .from(assets)
    .where(eq(assets.storageKey, meta.storage_key))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(assets)
    .values({
      kind: "image",
      mimeType: meta.mime_type ?? "image/png",
      storageKey: meta.storage_key,
      sizeBytes: meta.size_bytes ?? 0,
      width: meta.width ?? null,
      height: meta.height ?? null,
      sha256: meta.sha256 ?? "",
      source: "generated",
    })
    .returning();
  return created.id;
}

async function markDone(canvasId: string, nodeId: string, jobId: string, assetId?: string | null) {
  await setNodeStatus(canvasId, nodeId, "done", assetId ?? undefined);
  broadcastNodeStatus(canvasId, nodeId, "done", assetId ?? null, jobId);
  await markDownstreamDirty(canvasId, nodeId);
  await runReadyDirtyChildren(canvasId, nodeId);
}

async function getSourceNode(canvasId: string, nodeId: string) {
  const db = getDb();
  const [node] = await db
    .select({ position: canvasNodes.position })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  return (node?.position as { x: number; y: number }) ?? { x: 0, y: 0 };
}

// ── Dispatcher ──────────────────────────────────────────────────────

export async function applyAgentResult(
  jobType: string,
  canvasId: string,
  nodeId: string,
  result: Record<string, unknown>,
  jobId: string,
): Promise<void> {
  switch (jobType) {
    case "pipeline.script2characters": {
      const characters = normalizeAgentCharacters(result.characters);
      const position = await getSourceNode(canvasId, nodeId);
      const graph = buildCharacterSpawnGraph(nodeId, position, characters);
      await insertSpawnGraph(canvasId, graph.nodes, graph.edges);
      await markDone(canvasId, nodeId, jobId);
      return;
    }

    case "pipeline.idea2script": {
      const story = typeof result.story === "string" ? result.story : "";
      const scripts = Array.isArray(result.scripts)
        ? result.scripts.filter((s): s is string => typeof s === "string")
        : [];
      await updateNodeDataField(canvasId, nodeId, "story", story);
      await updateNodeDataField(canvasId, nodeId, "content", scripts.join("\n\n"));
      await markDone(canvasId, nodeId, jobId);
      return;
    }

    case "pipeline.plan_script": {
      await updateNodeDataField(canvasId, nodeId, "content", String(result.planned_script ?? ""));
      await markDone(canvasId, nodeId, jobId);
      return;
    }

    case "pipeline.enhance_script": {
      await updateNodeDataField(canvasId, nodeId, "content", String(result.enhanced_script ?? ""));
      await markDone(canvasId, nodeId, jobId);
      return;
    }

    case "pipeline.novel2scenes": {
      const scenes = normalizeAgentScenes(result.scenes);
      const characters = normalizeAgentCharacters(result.characters);
      const position = await getSourceNode(canvasId, nodeId);
      const sceneGraph = buildSceneSpawnGraph(nodeId, position, scenes);
      await insertSpawnGraph(canvasId, sceneGraph.nodes, sceneGraph.edges);

      const characterGraph = buildCharacterSpawnGraph(
        nodeId,
        { x: position.x + CHARACTER_ZONE_OFFSET.x, y: position.y },
        characters,
      );
      await insertSpawnGraph(canvasId, characterGraph.nodes, characterGraph.edges);
      await markDone(canvasId, nodeId, jobId);
      return;
    }

    case "pipeline.select_reference": {
      const plan = result.reference_plan as Record<string, unknown> | undefined;
      await updateNodeDataField(canvasId, nodeId, "referencePlan", plan ?? null);
      await markDone(canvasId, nodeId, jobId);
      return;
    }

    case "pipeline.select_best_image": {
      const best = result.best_image as { best_index?: number } | undefined;
      const db = getDb();
      const [node] = await db
        .select({ data: canvasNodes.data, outputAssetId: canvasNodes.outputAssetId })
        .from(canvasNodes)
        .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
        .limit(1);
      const variants = (node?.data as { variants?: VariantEntry[] } | undefined)?.variants;
      const chosen = pickBestVariant(variants, best?.best_index ?? 0);
      if (!chosen) {
        await markDone(canvasId, nodeId, jobId, node?.outputAssetId);
        return;
      }
      await markDone(canvasId, nodeId, jobId, chosen.assetId);
      return;
    }

    case "pipeline.camera_tree": {
      await updateNodeDataField(canvasId, nodeId, "cameraTree", result.camera_tree ?? null);
      await markDone(canvasId, nodeId, jobId);
      return;
    }

    case "pipeline.character_portraits": {
      const portraits = result.portraits as Record<string, PortraitAssetMeta> | undefined;
      if (!portraits) return;
      const frontAssetId = await createAssetFromMeta(portraits.front);
      const sideAssetId = portraits.side ? await createAssetFromMeta(portraits.side) : undefined;
      const backAssetId = portraits.back ? await createAssetFromMeta(portraits.back) : undefined;

      await updateNodeDataField(canvasId, nodeId, "frontAssetId", frontAssetId);
      if (sideAssetId) await updateNodeDataField(canvasId, nodeId, "sideAssetId", sideAssetId);
      if (backAssetId) await updateNodeDataField(canvasId, nodeId, "backAssetId", backAssetId);
      await markDone(canvasId, nodeId, jobId, frontAssetId);
      return;
    }

    case "image.compliance": {
      const reports = normalizeComplianceReports(result.reports);
      await updateNodeDataField(canvasId, nodeId, "complianceReports", reports);
      await markDone(canvasId, nodeId, jobId);
      return;
    }

    default:
      return;
  }
}

/** Worker compliance reports land as a JSON array — keep only well-formed
 * entries so a partial worker failure can't poison the node data. */
export function normalizeComplianceReports(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is Record<string, unknown> =>
      !!item && typeof item === "object" && typeof (item as { platform?: unknown }).platform === "string",
  );
}

/** Agent bridge job types whose completed output carries a JSON `result`. */
export function isAgentResultJob(jobType: string, output: { result?: unknown; cells?: unknown }): boolean {
  return jobType.startsWith("pipeline.") && output.result != null && !Array.isArray(output.cells);
}
