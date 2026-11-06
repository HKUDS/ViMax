import type { Edge, Node } from "@xyflow/react";

export function removeNodeFromGraph(
  nodes: Node[],
  edges: Edge[],
  nodeId: string,
): { nodes: Node[]; edges: Edge[] } {
  return {
    nodes: nodes.filter((node) => node.id !== nodeId),
    edges: edges.filter(
      (edge) => edge.source !== nodeId && edge.target !== nodeId,
    ),
  };
}

export function copyNode(node: Node, offset = 40): Node {
  return {
    ...node,
    id: crypto.randomUUID(),
    position: {
      x: node.position.x + offset,
      y: node.position.y + offset,
    },
    data: { ...node.data },
    selected: false,
  };
}

/** A clipboard snapshot: selected nodes plus the edges between them. */
export interface NodeClipboard {
  nodes: Node[];
  edges: Edge[];
}

/** Serialize the current selection (and its internal edges) for copy/paste. */
export function copySelectedToClipboard(nodes: Node[], edges: Edge[]): NodeClipboard {
  const selected = nodes.filter((n) => n.selected);
  const ids = new Set(selected.map((n) => n.id));
  return {
    nodes: selected,
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
  };
}

/**
 * Instantiate a clipboard snapshot as new nodes/edges with fresh ids.
 * Pasted nodes arrive selected and offset from their origin; edges between
 * pasted nodes are remapped to the new ids.
 */
export function instantiateClipboard(
  clipboard: NodeClipboard,
  offset = 20,
): { nodes: Node[]; edges: Edge[] } {
  const idMap = new Map(clipboard.nodes.map((n) => [n.id, crypto.randomUUID()]));
  const nodes = clipboard.nodes.map((n) => ({
    ...n,
    id: idMap.get(n.id)!,
    position: { x: n.position.x + offset, y: n.position.y + offset },
    data: { ...n.data },
    selected: true,
  }));
  const edges = clipboard.edges.map((e) => ({
    ...e,
    id: crypto.randomUUID(),
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
    selected: false,
  }));
  return { nodes, edges };
}
