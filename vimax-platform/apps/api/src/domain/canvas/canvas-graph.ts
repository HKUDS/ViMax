// ── Pure canvas graph operations ───────────────────────────────────
// No DB, no side-effects. All graph traversal and set-diff logic lives
// here so it can be unit-tested directly. The canvas service adapts its
// DB rows to the `EdgeLike` / `UpstreamNodeLike` shapes below.

import type { CanvasNodeType } from "@vimax/contracts";
import { RUNNABLE_NODE_TYPE_SET } from "@vimax/contracts";

/** Minimal edge shape — structurally compatible with the DB row. */
export interface EdgeLike {
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

/** Minimal upstream-node shape — only what upstream resolution needs. */
export interface UpstreamNodeLike {
  id: string;
  type: string;
  outputAssetId: string | null;
}

/** A single resolved upstream asset bound to a target input slot. */
export interface UpstreamInput {
  assetId: string;
  /** Id of the node this asset flows out of. */
  sourceNodeId: string;
  /** Handle on the source node the edge comes from (e.g. "output", "first_frame"). */
  sourceHandle: string | null;
  /** Handle on the target node the edge feeds into (e.g. "reference", "first_frame"). */
  targetHandle: string | null;
  sourceNodeType: string;
}

// ── Set difference ─────────────────────────────────────────────────

/**
 * IDs present in `existing` but absent from `incoming`. Used by the
 * canvas sync to know which nodes/edges have been removed client-side.
 *
 * Preserves `existing` order so deletion is deterministic.
 */
export function diffIds(existing: string[], incoming: string[]): string[] {
  const keep = new Set(incoming);
  return existing.filter((id) => !keep.has(id));
}

// ── Downstream traversal ───────────────────────────────────────────

/**
 * All node IDs reachable from `startNodeId` by following edges in the
 * forward (source → target) direction, excluding `startNodeId` itself.
 *
 * Handles cycles safely (visited set). Order is BFS discovery order.
 */
export function collectDownstreamNodeIds(
  edges: EdgeLike[],
  startNodeId: string,
): string[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.sourceNodeId);
    if (targets === undefined) {
      adjacency.set(edge.sourceNodeId, [edge.targetNodeId]);
    } else {
      targets.push(edge.targetNodeId);
    }
  }

  // Seed visited with the start node so cycles that return to it never
  // re-add it, and the start node is excluded from the result by construction.
  const visited = new Set<string>([startNodeId]);
  const queue: string[] = [startNodeId];
  const result: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const targets = adjacency.get(current);
    if (targets === undefined) continue;
    for (const target of targets) {
      if (visited.has(target)) continue;
      visited.add(target);
      result.push(target);
      queue.push(target);
    }
  }

  return result;
}

export function collectScriptChainNodeIds(
  nodes: Array<{ id: string; type: string; data?: unknown }>,
  edges: EdgeLike[],
  scriptNodeId: string,
): Set<string> {
  const ids = new Set([scriptNodeId, ...collectDownstreamNodeIds(edges, scriptNodeId)]);
  for (const edge of edges) {
    const source = nodes.find((node) => node.id === edge.sourceNodeId);
    const data = source?.data as Record<string, unknown> | undefined;
    if (ids.has(edge.targetNodeId) && source?.type === "image" &&
      Array.isArray(data?.referenceAssetIds) && data.referenceAssetIds.length > 0) {
      ids.add(source.id);
    }
  }
  return ids;
}

// ── Upstream resolution ────────────────────────────────────────────

/**
 * Resolve every upstream asset feeding into `targetNodeId`, preserving
 * the source/target handle of each connection.
 *
 * Nodes referenced by an edge but missing from `nodes` (or without an
 * output asset) are skipped — they contribute nothing to the target.
 */
export function resolveUpstreamInputs(
  edges: EdgeLike[],
  nodes: Map<string, UpstreamNodeLike>,
  targetNodeId: string,
): UpstreamInput[] {
  const result: UpstreamInput[] = [];
  for (const edge of edges) {
    if (edge.targetNodeId !== targetNodeId) continue;
    const source = nodes.get(edge.sourceNodeId);
    if (source === undefined || source.outputAssetId === null) continue;
    result.push({
      assetId: source.outputAssetId,
      sourceNodeId: edge.sourceNodeId,
      sourceHandle: edge.sourceHandle ?? null,
      targetHandle: edge.targetHandle ?? null,
      sourceNodeType: source.type,
    });
  }
  return result;
}

/**
 * Pick the asset id bound to a specific target handle (e.g. "first_frame").
 * Returns `null` when no edge carries that handle.
 */
export function pickByHandle(
  inputs: UpstreamInput[],
  handle: string,
): string | null {
  const found = inputs.find((input) => input.targetHandle === handle);
  return found?.assetId ?? null;
}

// ── Subgraph re-run readiness ──────────────────────────────────────

/**
 * Node types that produce an output asset when run — see
 * `RUNNABLE_NODE_TYPE_SET` in @vimax/contracts for the web/api-shared
 * definition and its executor-mirroring constraint.
 */

/** Runtime status + type for a canvas node. */
export interface NodeRuntimeLike {
  id: string;
  status: string;
  type: string;
}

/**
 * A node is ready to run when every *runnable* upstream that feeds it has
 * already produced its output (`status === "done"`). Non-runnable
 * upstreams and unknown sources are ignored, and a node with no runnable
 * upstream is always ready.
 */
export function isReadyToRun(
  nodeId: string,
  edges: EdgeLike[],
  nodes: Map<string, NodeRuntimeLike>,
): boolean {
  for (const edge of edges) {
    if (edge.targetNodeId !== nodeId) continue;
    const source = nodes.get(edge.sourceNodeId);
    if (source === undefined) continue;
    if (!RUNNABLE_NODE_TYPE_SET.has(source.type)) continue;
    if (source.status !== "done") return false;
  }
  return true;
}

function isDirty(node: NodeRuntimeLike | undefined): node is NodeRuntimeLike {
  return node !== undefined && node.status === "dirty";
}

/**
 * Direct dirty children of `completedNodeId` that are now ready to run
 * (all their runnable upstreams are `done`). Drives the reactive cascade:
 * when a node finishes, its newly-stale descendants re-run automatically.
 */
export function readyDirtyChildrenOf(
  edges: EdgeLike[],
  nodes: Map<string, NodeRuntimeLike>,
  completedNodeId: string,
): string[] {
  const result: string[] = [];
  for (const edge of edges) {
    if (edge.sourceNodeId !== completedNodeId) continue;
    const child = nodes.get(edge.targetNodeId);
    if (!isDirty(child)) continue;
    if (isReadyToRun(edge.targetNodeId, edges, nodes)) {
      result.push(edge.targetNodeId);
    }
  }
  return [...new Set(result)];
}

/**
 * Every dirty node in the graph whose runnable upstreams are all `done`.
 * Used by the manual "re-run all dirty nodes" action to resume nodes that
 * are stale but not part of an in-flight cascade.
 */
export function readyDirtyNodes(
  edges: EdgeLike[],
  nodes: Map<string, NodeRuntimeLike>,
): string[] {
  const result: string[] = [];
  for (const [id, node] of nodes) {
    if (!isDirty(node)) continue;
    if (isReadyToRun(id, edges, nodes)) result.push(id);
  }
  return result;
}

// ── Auto-wire (type-based edge inference) ──────────────────────────

/** Node reduced to what edge inference needs. */
export interface AutoWireNode {
  id: string;
  type: CanvasNodeType;
}

/** An edge inferred by auto-wire, before it is persisted. */
export interface InferredEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle: string | null;
  targetHandle: string | null;
}

interface WireRule {
  from: CanvasNodeType;
  to: CanvasNodeType;
  /** "fanout": every source → every target. "pair": source[i] → target[i]. */
  mode: "fanout" | "pair";
  sourceHandle: string | null;
  targetHandle: string | null;
}

// Successor rules in dependency order. Handles mirror the conventions
// used elsewhere (first_frame / last_frame / reference / output / input)
// so the wired graph feeds the executors correctly.
const WIRE_RULES: readonly WireRule[] = [
  { from: "script", to: "storyboard_cell", mode: "fanout", sourceHandle: null, targetHandle: "reference" },
  { from: "script", to: "character", mode: "fanout", sourceHandle: null, targetHandle: "reference" },
  { from: "character", to: "shot", mode: "fanout", sourceHandle: "output", targetHandle: "reference" },
  { from: "storyboard_cell", to: "shot", mode: "pair", sourceHandle: "output", targetHandle: "reference" },
  { from: "shot", to: "image", mode: "pair", sourceHandle: "first_frame", targetHandle: "reference" },
  { from: "image", to: "video", mode: "pair", sourceHandle: "output", targetHandle: "first_frame" },
  { from: "video", to: "concat", mode: "pair", sourceHandle: "output", targetHandle: "input" },
];

/** Index-clamp so surplus targets fold onto the last source. */
function clampIndex(i: number, len: number): number {
  return len === 0 ? 0 : Math.min(i, len - 1);
}

/**
 * Infer a sensible DAG for a set of nodes based on type-dependency rules.
 *
 * - `fanout` rules connect every source to every target (e.g. one script
 *   feeds all its storyboard cells).
 * - `pair` rules connect sources to targets positionally — but only nodes
 *   not already linked by `existingEdges` under the same rule. Surplus
 *   targets fold onto the last free source (a source may legitimately feed
 *   several targets, e.g. one shot driving variant images); surplus
 *   sources dangle instead of folding onto a target — two first_frame
 *   feeds into one video is how cross-shot contamination happens.
 *
 * Edge ids come from `idGenerator` (inject for deterministic tests).
 */
export function inferAutoEdges(
  nodes: AutoWireNode[],
  idGenerator: () => string,
  existingEdges: EdgeLike[] = [],
): InferredEdge[] {
  const byType = new Map<CanvasNodeType, string[]>();
  for (const n of nodes) {
    const list = byType.get(n.type);
    if (list === undefined) byType.set(n.type, [n.id]);
    else list.push(n.id);
  }

  const edges: InferredEdge[] = [];
  for (const rule of WIRE_RULES) {
    const sources = byType.get(rule.from) ?? [];
    const targets = byType.get(rule.to) ?? [];
    if (sources.length === 0 || targets.length === 0) continue;

    if (rule.mode === "fanout") {
      for (const s of sources) {
        for (const t of targets) {
          edges.push({
            id: idGenerator(),
            sourceNodeId: s,
            targetNodeId: t,
            sourceHandle: rule.sourceHandle,
            targetHandle: rule.targetHandle,
          });
        }
      }
    } else {
      const typeById = new Map(nodes.map((n) => [n.id, n.type] as const));
      const sourceTaken = new Set<string>();
      const targetTaken = new Set<string>();
      for (const e of existingEdges) {
        if (
          typeById.get(e.sourceNodeId) === rule.from &&
          typeById.get(e.targetNodeId) === rule.to
        ) {
          sourceTaken.add(e.sourceNodeId);
          targetTaken.add(e.targetNodeId);
        }
      }
      const freeSources = sources.filter((s) => !sourceTaken.has(s));
      const freeTargets = targets.filter((t) => !targetTaken.has(t));
      for (let i = 0; i < freeTargets.length && freeSources.length > 0; i++) {
        const t = freeTargets[i]!;
        const s = freeSources[clampIndex(i, freeSources.length)]!;
        edges.push({
          id: idGenerator(),
          sourceNodeId: s,
          targetNodeId: t,
          sourceHandle: rule.sourceHandle,
          targetHandle: rule.targetHandle,
        });
      }
    }
  }

  return edges;
}

/** Signature used to tell two edges apart for de-duplication. */
function edgeKey(e: { sourceNodeId: string; targetNodeId: string; sourceHandle?: string | null; targetHandle?: string | null }): string {
  return `${e.sourceNodeId}|${e.targetNodeId}|${e.sourceHandle ?? ""}|${e.targetHandle ?? ""}`;
}

/**
 * Return candidates whose (source, target, handles) signature is not
 * already present in `existing`. Keeps auto-wire idempotent: clicking it
 * again adds nothing.
 */
export function subtractEdges<T extends EdgeLike>(candidates: T[], existing: EdgeLike[]): T[] {
  const present = new Set(existing.map(edgeKey));
  const seen = new Set<string>();
  const result: T[] = [];
  for (const c of candidates) {
    const k = edgeKey(c);
    if (present.has(k) || seen.has(k)) continue;
    seen.add(k);
    result.push(c);
  }
  return result;
}

// ── Shot generation mode (variation_type → t2i/i2i) ───────────────
//
// A shot's `variationType` mirrors idea2video's `variation_type`: how much
// the last frame differs from the first. A `large` variation is a bold
// composition change or exaggerated transition — forcing it onto a reference
// frame (i2i) only fights the reference, so it is generated fresh (t2i).
// `small`/`medium` variations keep continuity with the reference (i2i) when
// one is available, falling back to t2i otherwise. Nodes without a variation
// type behave as before (i2i when a reference exists, else t2i).

export type ShotVariationType = "large" | "medium" | "small";

export interface ShotModeDecision {
  mode: "t2i" | "i2i";
  /** Appended to the generation prompt to steer the model toward the intended
   * degree of continuity vs. reinvention. Empty when no steering is needed. */
  promptSuffix: string;
}

const SHOT_SUFFIXES = {
  large: "significant composition change, bold cinematic transition, reinvent the framing",
  medium: "introduce a new element while maintaining continuity with the reference",
  small: "subtle change, preserve the reference composition and continuity",
} as const satisfies Record<ShotVariationType, string>;

export function resolveShotMode(
  variationType: ShotVariationType | undefined,
  hasReference: boolean,
): ShotModeDecision {
  if (variationType === "large") {
    return { mode: "t2i", promptSuffix: SHOT_SUFFIXES.large };
  }
  if (hasReference) {
    return {
      mode: "i2i",
      promptSuffix: variationType ? SHOT_SUFFIXES[variationType] : "",
    };
  }
  return { mode: "t2i", promptSuffix: "" };
}

// ── Character portrait reference extraction ────────────────────────
//
// Given a set of character nodes, pick each one's reference asset — the
// three-view front portrait (frontAssetId) when available, otherwise the
// node's generic output. Used by runShotNode to feed visible characters'
// portraits into a shot's first frame for cross-shot consistency.

export interface CharacterAssetLike {
  id: string;
  outputAssetId: string | null;
  data: unknown;
}

export function normalizeCharacterAssets(
  characters: CharacterAssetLike[],
): string[] {
  const result: string[] = [];
  for (const c of characters) {
    const front = (c.data as { frontAssetId?: string } | null)?.frontAssetId;
    const assetId = front ?? c.outputAssetId;
    if (assetId) result.push(assetId);
  }
  return result;
}
