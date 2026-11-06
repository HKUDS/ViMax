// ── Dagre Auto-Layout Utility ────────────────────────────────────────
// Provides automatic graph layout using Dagre algorithm.
// Adapted from Toonflow-web's dagre.ts (Vue Flow → React Flow adaptation).

import Dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";
import type { CanvasNodeType } from "@vimax/contracts";
import { NODE_TYPE_VISUALS } from "../constants/node-visuals";

// ── Layout Direction ────────────────────────────────────────────────

export type LayoutDirection = "LR" | "TB";

// ── Node dimensions per type (approximate rendered size) ────────────

const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  script: { width: 260, height: 180 },
  character: { width: 220, height: 200 },
  storyboard_cell: { width: 240, height: 160 },
  shot: { width: 280, height: 220 },
  image: { width: 240, height: 200 },
  video: { width: 240, height: 180 },
  concat: { width: 240, height: 160 },
};

const DEFAULT_DIMENSION = { width: 260, height: 180 };

// ── Compute Dagre Layout ────────────────────────────────────────────

export function computeDagreLayout(
  nodes: Node[],
  edges: Edge[],
  direction: LayoutDirection = "LR",
): Node[] {
  if (nodes.length === 0) return nodes;

  const g = new Dagre.graphlib.Graph()
    .setDefaultEdgeLabel(() => ({}))
    .setGraph({
      rankdir: direction,
      nodesep: 80,
      ranksep: 120,
      marginx: 40,
      marginy: 40,
    });

  // Add nodes with their dimensions
  for (const node of nodes) {
    const dims = NODE_DIMENSIONS[node.type ?? ""] ?? DEFAULT_DIMENSION;
    g.setNode(node.id, dims);
  }

  // Add edges
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  // Run layout
  Dagre.layout(g);

  // Apply computed positions
  return nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    if (!nodeWithPosition) return node;

    const dims = NODE_DIMENSIONS[node.type ?? ""] ?? DEFAULT_DIMENSION;

    // Dagre gives center positions, but React Flow uses top-left
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - dims.width / 2,
        y: nodeWithPosition.y - dims.height / 2,
      },
    };
  });
}

// ── Zone-based layout (LibTV-style spatial organization) ────────────
//
// Seven columns left → right, one per node type, mirroring the production
// pipeline (剧本 → 角色 → 分镜 → 镜头 → 首帧 → 视频 → 合成). Nodes stack
// vertically inside their column. ZoneBackgroundLayer draws the labelled
// backdrop using the same coordinates, so a zone-arranged canvas reads as a
// pipeline at a glance.

export const ZONE_LAYOUT: Record<CanvasNodeType, { x: number; y: number }> = {
  script: { x: 40, y: 60 },
  character: { x: 380, y: 60 },
  storyboard_cell: { x: 720, y: 60 },
  shot: { x: 1060, y: 60 },
  image: { x: 1400, y: 60 },
  video: { x: 1740, y: 60 },
  concat: { x: 2080, y: 60 },
  audio: { x: 2080, y: 420 },
};

/** Zone header metadata, derived from the shared node-type visual map so
 * canvas nodes, palette, zones and minimap all read one source. Icons are
 * rendered from NODE_TYPE_VISUALS in ZoneBackgroundLayer, not as strings. */
export const ZONE_META: Record<
  CanvasNodeType,
  { label: string; icon: string; color: string }
> = Object.fromEntries(
  Object.entries(NODE_TYPE_VISUALS).map(([type, visual]) => [
    type,
    { label: visual.label, icon: "", color: `var(${visual.colorVar})` },
  ]),
) as Record<CanvasNodeType, { label: string; icon: string; color: string }>;

/** Fixed backdrop box per zone (title bar + room for ~3 stacked nodes). */
export const ZONE_BOX = { width: 300, height: 760 };

const ZONE_TITLE_HEIGHT = 36;
// Row height must exceed the tallest node (shot = 220) so stacked nodes
// never overlap.
const ZONE_ROW_HEIGHT = 240;

export function computeZoneLayout(nodes: Node[]): Node[] {
  const typeCounts: Record<string, number> = {};
  return nodes.map((n) => {
    const type = (n.type ?? "image") as CanvasNodeType;
    const zone = ZONE_LAYOUT[type] ?? { x: 100, y: 100 };
    const idx = typeCounts[type] ?? 0;
    typeCounts[type] = idx + 1;
    return {
      ...n,
      position: {
        x: zone.x + 16,
        y: zone.y + ZONE_TITLE_HEIGHT + idx * ZONE_ROW_HEIGHT,
      },
    };
  });
}
