// ── Edge Relations (LibTV-style workflow relationship semantics) ────
//
// Edges on the canvas are classified into named relationships derived
// from the (source type, target type) pair, mirroring LibLibTV's
// production workflow: script drives structure, characters reference
// shots/images, the storyboard splits into shots, and the shot → image →
// video → concat chain carries the actual media downstream.
//
// Pure module — no React, no side effects — so the classification and
// the flow-animation rules stay unit-testable.

import type { Edge, Node } from "@xyflow/react";
import { NODE_TYPE_HEX } from "./node-visuals";

export type EdgeRelation =
  | "script_drive" // 剧本驱动: script → storyboard/character
  | "character_ref" // 角色参考: character → shot/image
  | "storyboard_split" // 分镜分解: storyboard_cell → shot
  | "production_flow" // 生产主链: shot → image → video
  | "sequence" // 剪辑序列: video → concat
  | "generic"; // 其他手动连线

interface RelationStyle {
  label: string;
  stroke: string;
}

/** Edge strokes reuse the source node-type ramp so a node and its outgoing
 * edges read as one semantic family at a glance. */
const RELATION_STYLES: Record<EdgeRelation, RelationStyle> = {
  script_drive: { label: "剧本驱动", stroke: NODE_TYPE_HEX.script },
  character_ref: { label: "角色参考", stroke: NODE_TYPE_HEX.character },
  storyboard_split: { label: "分镜分解", stroke: NODE_TYPE_HEX.storyboard_cell },
  production_flow: { label: "生产主链", stroke: NODE_TYPE_HEX.shot },
  sequence: { label: "剪辑序列", stroke: NODE_TYPE_HEX.video },
  generic: { label: "关联", stroke: "#6e6e78" },
};

/** Ordered legend entries for the canvas overlay. */
export const EDGE_RELATION_LEGEND: readonly (RelationStyle & {
  relation: EdgeRelation;
})[] = (Object.keys(RELATION_STYLES) as EdgeRelation[]).map((relation) => ({
  relation,
  ...RELATION_STYLES[relation],
}));

const RELATION_BY_PAIR = new Map<string, EdgeRelation>([
  // 剧本驱动：剧本喂给分镜与角色两个结构分支
  ["script|storyboard_cell", "script_drive"],
  ["script|character", "script_drive"],
  // 角色参考：角色资产作为镜头/图片的一致性参考
  ["character|shot", "character_ref"],
  ["character|image", "character_ref"],
  // 分镜分解：一个分镜格拆出一个镜头
  ["storyboard_cell|shot", "storyboard_split"],
  // 生产主链：媒体内容真正向下游流动的链路
  ["shot|image", "production_flow"],
  ["shot|video", "production_flow"],
  ["image|video", "production_flow"],
  ["image|image", "production_flow"],
  ["video|video", "production_flow"],
  // 剪辑序列：多个视频汇入合成
  ["video|concat", "sequence"],
]);

export function classifyEdge(
  sourceType: string | undefined,
  targetType: string | undefined,
): EdgeRelation {
  return (
    RELATION_BY_PAIR.get(`${sourceType ?? ""}|${targetType ?? ""}`) ?? "generic"
  );
}

/** Visual treatment applied to a rendered edge path. */
export interface EdgeVisual {
  stroke: string;
  strokeWidth: number;
  /** Dash cycle length in px — 0 means a solid (non-flowing) line. */
  dash: number;
  /** Seconds per dash cycle. 0 = no flow animation. */
  flowSpeed: number;
  label: string;
}

const DASH = 7; // dash 7 + gap 7 → cycle 14, matching the -14 keyframe offset
const IDLE_SPEED = 3.5; // 慢速流动，给整条链路呼吸感
const ACTIVE_SPEED = 0.9; // 节点运行中：数据明显在流动

/**
 * Derive the visual treatment for one edge. Edges attached to a running
 * node flow noticeably faster and thicker (production is "moving" through
 * them); a failed endpoint turns the edge solid red and stops the flow.
 */
export function edgeVisualFor(
  relation: EdgeRelation,
  sourceStatus: string | undefined,
  targetStatus: string | undefined,
): EdgeVisual {
  const style = RELATION_STYLES[relation];
  if (sourceStatus === "failed" || targetStatus === "failed") {
    return { stroke: "var(--color-node-error)", strokeWidth: 2, dash: 0, flowSpeed: 0, label: style.label };
  }
  const active = sourceStatus === "running" || targetStatus === "running";
  return {
    stroke: style.stroke,
    strokeWidth: active ? 3.2 : 2,
    dash: DASH,
    flowSpeed: active ? ACTIVE_SPEED : IDLE_SPEED,
    label: style.label,
  };
}

/**
 * Overlay relation visuals onto React Flow edges. Derived at render time
 * from the current node graph — the stored edge rows stay untouched, so
 * save/sync round-trips are unaffected.
 *
 * Handle ids are also stripped for rendering: node components expose a
 * single anonymous source/target handle, so edges carrying semantic ids
 * ("output" / "reference" / "first_frame") have no anchor to bind to and
 * React Flow silently skips them. The stored rows keep the real handles —
 * the executors resolve upstream inputs by handle.
 */
export function withEdgeVisuals<T extends Edge>(edges: T[], nodes: Node[]): T[] {
  const statusById = new Map(
    nodes.map((n) => [n.id, (n.data as { status?: string } | undefined)?.status]),
  );
  const typeById = new Map(nodes.map((n) => [n.id, n.type]));

  return edges.map((edge) => {
    const relation = classifyEdge(typeById.get(edge.source), typeById.get(edge.target));
    const visual = edgeVisualFor(
      relation,
      statusById.get(edge.source),
      statusById.get(edge.target),
    );
    return {
      ...edge,
      sourceHandle: undefined,
      targetHandle: undefined,
      style: {
        ...edge.style,
        stroke: visual.stroke,
        strokeWidth: visual.strokeWidth,
        ...(visual.dash > 0
          ? {
              strokeDasharray: visual.dash,
              animation: `vimax-edge-flow ${visual.flowSpeed}s linear infinite`,
            }
          : {}),
      },
    };
  });
}
