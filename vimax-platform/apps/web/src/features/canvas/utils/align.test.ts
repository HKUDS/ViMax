import assert from "node:assert/strict";
import test from "node:test";
import type { Node } from "@xyflow/react";
import { alignSelectedNodes, distributeSelectedNodes } from "./align.js";

function node(id: string, x: number, y: number, selected = true): Node {
  return { id, position: { x, y }, data: {}, selected };
}

test("align left moves selected nodes to the smallest x", () => {
  const nodes = [node("a", 100, 0), node("b", 300, 50), node("c", 200, 0, false)];

  const result = alignSelectedNodes(nodes, "left");

  assert.equal(result.find((n) => n.id === "a")!.position.x, 100);
  assert.equal(result.find((n) => n.id === "b")!.position.x, 100);
  assert.equal(result.find((n) => n.id === "c")!.position.x, 200); // unselected untouched
});

test("align vcenter keeps x and equalizes y to the bounding-box center", () => {
  const nodes = [node("a", 0, 0), node("b", 100, 80)];

  const result = alignSelectedNodes(nodes, "vcenter");

  assert.deepEqual(
    result.map((n) => n.position.y),
    [100, 100], // spans 0..80+120(fallback h) → center line at y=100
  );
  assert.deepEqual(
    result.map((n) => n.position.x),
    [0, 100],
  );
});

test("align with fewer than 2 selected is a no-op", () => {
  const nodes = [node("a", 0, 0), node("b", 100, 100, false)];

  assert.equal(alignSelectedNodes(nodes, "left"), nodes);
});

test("distribute evenly spaces three selected nodes", () => {
  const nodes = [node("a", 0, 0), node("b", 50, 40), node("c", 200, 0)];

  const result = distributeSelectedNodes(nodes, "horizontal");

  assert.deepEqual(
    result.map((n) => n.position.x),
    [0, 100, 200],
  );
});

test("distribute with fewer than 3 selected is a no-op", () => {
  const nodes = [node("a", 0, 0), node("b", 100, 0)];

  assert.equal(distributeSelectedNodes(nodes, "vertical"), nodes);
});

test("distribute ignores unselected nodes", () => {
  const nodes = [
    node("a", 0, 0),
    node("b", 60, 0),
    node("c", 120, 0),
    node("d", 500, 500, false),
  ];

  const result = distributeSelectedNodes(nodes, "horizontal");

  assert.equal(result.find((n) => n.id === "d")!.position.x, 500);
  assert.deepEqual(
    result.filter((n) => n.selected).map((n) => n.position.x),
    [0, 60, 120],
  );
});
