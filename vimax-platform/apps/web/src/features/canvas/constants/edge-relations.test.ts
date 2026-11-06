import assert from "node:assert/strict";
import test from "node:test";
import type { Edge } from "@xyflow/react";
import {
  classifyEdge,
  edgeVisualFor,
  withEdgeVisuals,
} from "./edge-relations";
import { NODE_TYPE_HEX } from "./node-visuals";

test("classifyEdge maps production-chain pairs to their relations", () => {
  assert.equal(classifyEdge("script", "storyboard_cell"), "script_drive");
  assert.equal(classifyEdge("script", "character"), "script_drive");
  assert.equal(classifyEdge("character", "shot"), "character_ref");
  assert.equal(classifyEdge("character", "image"), "character_ref");
  assert.equal(classifyEdge("storyboard_cell", "shot"), "storyboard_split");
  assert.equal(classifyEdge("shot", "image"), "production_flow");
  assert.equal(classifyEdge("image", "video"), "production_flow");
  assert.equal(classifyEdge("video", "concat"), "sequence");
});

test("classifyEdge falls back to generic for unknown or missing types", () => {
  assert.equal(classifyEdge("concat", "script"), "generic");
  assert.equal(classifyEdge(undefined, "image"), "generic");
  assert.equal(classifyEdge("shot", undefined), "generic");
});

test("edgeVisualFor slows idle edges and speeds up running ones", () => {
  const idle = edgeVisualFor("production_flow", "done", "idle");
  assert.equal(idle.flowSpeed > 2, true);
  assert.equal(idle.strokeWidth <= 2.5, true);

  const active = edgeVisualFor("production_flow", "running", "idle");
  assert.equal(active.flowSpeed < 1.5, true);
  assert.equal(active.strokeWidth > idle.strokeWidth, true);
  assert.equal(active.stroke, NODE_TYPE_HEX.shot);
});

test("edgeVisualFor marks failed endpoints solid red without flow", () => {
  const failed = edgeVisualFor("sequence", "done", "failed");
  assert.equal(failed.stroke, "var(--color-node-error)");
  assert.equal(failed.flowSpeed, 0);
  assert.equal(failed.dash, 0);
});

test("withEdgeVisuals derives stroke and flow animation without mutating ids", () => {
  const nodes = [
    { id: "s", type: "image", data: { status: "running" } },
    { id: "t", type: "video", data: { status: "idle" } },
  ];
  const edges: Edge[] = [{ id: "e1", source: "s", target: "t" }];
  const [out] = withEdgeVisuals(edges, nodes as never);

  assert.equal(out.id, "e1");
  assert.equal(out.style?.stroke, NODE_TYPE_HEX.shot);
  assert.match(String(out.style?.animation), /vimax-edge-flow/);
});

test("withEdgeVisuals strips semantic handle ids so every edge gets an anchor", () => {
  const nodes = [
    { id: "s", type: "storyboard_cell", data: { status: "done" } },
    { id: "t", type: "shot", data: { status: "idle" } },
  ];
  const [out] = withEdgeVisuals(
    [
      {
        id: "e",
        source: "s",
        target: "t",
        sourceHandle: "output",
        targetHandle: "reference",
      } as Edge,
    ],
    nodes as never,
  );

  assert.equal(out.sourceHandle, undefined);
  assert.equal(out.targetHandle, undefined);
  assert.equal(out.style?.stroke, NODE_TYPE_HEX.storyboard_cell);
});

test("withEdgeVisuals keeps unknown edges flowing in neutral grey", () => {
  const nodes = [
    { id: "a", type: "script", data: { status: "done" } },
    { id: "b", type: "concat", data: { status: "idle" } },
  ];
  const [out] = withEdgeVisuals(
    [{ id: "e", source: "a", target: "b" }] as Edge[],
    nodes as never,
  );

  assert.equal(out.style?.stroke, "#6e6e78");
  assert.match(String(out.style?.animation), /vimax-edge-flow/);
});
