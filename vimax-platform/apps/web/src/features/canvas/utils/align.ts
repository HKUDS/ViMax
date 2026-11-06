import type { Node } from "@xyflow/react";

export type AlignMode = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";
export type DistributeMode = "horizontal" | "vertical";

interface NodeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function nodeRect(n: Node): NodeRect {
  return {
    x: n.position.x,
    y: n.position.y,
    w: n.measured?.width ?? n.width ?? 220,
    h: n.measured?.height ?? n.height ?? 120,
  };
}

function moveRect(n: Node, rect: NodeRect, target: { x?: number; y?: number }): Node {
  return {
    ...n,
    position: {
      x: target.x !== undefined ? n.position.x + (target.x - rect.x) : n.position.x,
      y: target.y !== undefined ? n.position.y + (target.y - rect.y) : n.position.y,
    },
  };
}

/**
 * Align the selected nodes to a common edge/center line. Unselected nodes are
 * returned untouched; fewer than 2 selected is a no-op.
 */
export function alignSelectedNodes(nodes: Node[], mode: AlignMode): Node[] {
  const selected = nodes.filter((n) => n.selected);
  if (selected.length < 2) return nodes;

  const rects = new Map<string, NodeRect>(selected.map((n) => [n.id, nodeRect(n)]));
  const xs = [...rects.values()].map((r) => r.x);
  const ys = [...rects.values()].map((r) => r.y);
  const rights = [...rects.values()].map((r) => r.x + r.w);
  const bottoms = [...rects.values()].map((r) => r.y + r.h);
  const centerX = (Math.min(...xs) + Math.max(...rights)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...bottoms)) / 2;

  const target: { x?: number; y?: number } = {};
  switch (mode) {
    case "left": target.x = Math.min(...xs); break;
    case "right": target.x = Math.max(...rights); break;
    case "hcenter": target.x = centerX; break;
    case "top": target.y = Math.min(...ys); break;
    case "bottom": target.y = Math.max(...bottoms); break;
    case "vcenter": target.y = centerY; break;
  }

  return nodes.map((n) => {
    const rect = rects.get(n.id);
    return rect ? moveRect(n, rect, target) : n;
  });
}

/**
 * Evenly space the selected nodes' centers between the two extremes along
 * the given axis. Unselected nodes are returned untouched; fewer than 3
 * selected is a no-op (two nodes are already trivially "distributed").
 */
export function distributeSelectedNodes(nodes: Node[], mode: DistributeMode): Node[] {
  const selected = nodes.filter((n) => n.selected);
  if (selected.length < 3) return nodes;

  const horizontal = mode === "horizontal";
  const sorted = [...selected].sort((a, b) =>
    horizontal ? a.position.x - b.position.x : a.position.y - b.position.y,
  );
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const start = horizontal ? first.position.x : first.position.y;
  const end = horizontal ? last.position.x : last.position.y;
  const step = (end - start) / (sorted.length - 1);

  const targets = new Map<string, number>(
    sorted.map((n, i) => [n.id, start + i * step]),
  );

  return nodes.map((n) => {
    const rect = nodeRect(n);
    const target = targets.get(n.id);
    if (target === undefined) return n;
    // Distribute moves the leading edge so centers land `step` apart only when
    // nodes share a size; leading-edge spacing keeps the visual order stable.
    return horizontal ? moveRect(n, rect, { x: target }) : moveRect(n, rect, { y: target });
  });
}
