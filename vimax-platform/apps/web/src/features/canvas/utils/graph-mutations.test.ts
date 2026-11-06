import assert from "node:assert/strict";
import test from "node:test";
import type { Edge, Node } from "@xyflow/react";
import { copyNode, copySelectedToClipboard, instantiateClipboard, removeNodeFromGraph } from "./graph-mutations.js";

const nodes: Node[] = [
  { id: "a", position: { x: 0, y: 0 }, data: {} },
  { id: "b", position: { x: 100, y: 0 }, data: {} },
];

const edges: Edge[] = [
  { id: "e1", source: "a", target: "b" },
  { id: "e2", source: "b", target: "a" },
];

test("removeNodeFromGraph removes node and connected edges", () => {
  const result = removeNodeFromGraph(nodes, edges, "a");

  assert.deepEqual(result.nodes.map((node) => node.id), ["b"]);
  assert.equal(result.edges.length, 0);
});

test("copyNode creates a new id and offset position", () => {
  const source = nodes[0]!;
  const copied = copyNode(source, 20);

  assert.notEqual(copied.id, source.id);
  assert.equal(copied.position.x, 20);
  assert.equal(copied.position.y, 20);
  assert.notEqual(copied.data, source.data);
});

test("copySelectedToClipboard keeps only selected nodes and their internal edges", () => {
  const graph: Node[] = [
    { id: "a", position: { x: 0, y: 0 }, data: {}, selected: true },
    { id: "b", position: { x: 100, y: 0 }, data: {}, selected: true },
    { id: "c", position: { x: 200, y: 0 }, data: {} },
  ];
  const graphEdges: Edge[] = [
    { id: "e-ab", source: "a", target: "b" },
    { id: "e-ac", source: "a", target: "c" },
  ];

  const clipboard = copySelectedToClipboard(graph, graphEdges);

  assert.deepEqual(clipboard.nodes.map((n) => n.id), ["a", "b"]);
  assert.deepEqual(clipboard.edges.map((e) => e.id), ["e-ab"]);
});

test("instantiateClipboard remaps ids and preserves internal edges", () => {
  const clipboard = {
    nodes: [
      { id: "a", position: { x: 0, y: 0 }, data: { k: 1 }, selected: true },
      { id: "b", position: { x: 100, y: 0 }, data: {}, selected: true },
    ],
    edges: [{ id: "e", source: "a", target: "b" }],
  };

  const { nodes: pasted, edges } = instantiateClipboard(clipboard, 20);

  const idMap = new Map([["a", pasted[0]!.id], ["b", pasted[1]!.id]]);
  assert.deepEqual(pasted.map((n) => n.position), [{ x: 20, y: 20 }, { x: 120, y: 20 }]);
  assert.deepEqual(pasted.map((n) => n.selected), [true, true]);
  assert.deepEqual(pasted[0]!.data, { k: 1 });
  assert.equal(edges.length, 1);
  assert.equal(edges[0]!.source, idMap.get("a"));
  assert.equal(edges[0]!.target, idMap.get("b"));
  assert.notEqual(edges[0]!.id, "e");
});
