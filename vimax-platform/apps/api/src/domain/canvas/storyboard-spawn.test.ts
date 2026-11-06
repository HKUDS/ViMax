import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStoryboardSpawnGraph,
  STORYBOARD_ROW_HEIGHT,
  STORYBOARD_ZONE,
} from "./storyboard-spawn.js";

const cells = [
  { shotBrief: "镜头1", cameraIdx: 0, ffDesc: "", lfDesc: "", motionDesc: "" },
  { shotBrief: "镜头2", cameraIdx: 1, ffDesc: "", lfDesc: "", motionDesc: "" },
  { shotBrief: "镜头3", cameraIdx: 2, ffDesc: "", lfDesc: "", motionDesc: "" },
];

test("buildStoryboardSpawnGraph creates one node per cell", () => {
  const { nodes } = buildStoryboardSpawnGraph("script-1", cells);
  assert.equal(nodes.length, 3);
  assert.equal(nodes[0]?.type, "storyboard_cell");
  assert.equal(nodes[0]?.data.shotBrief, "镜头1");
});

test("buildStoryboardSpawnGraph stacks nodes vertically in storyboard zone", () => {
  const { nodes } = buildStoryboardSpawnGraph("script-1", cells);
  assert.equal(nodes[0]?.position.x, STORYBOARD_ZONE.x);
  assert.equal(nodes[0]?.position.y, STORYBOARD_ZONE.y);
  assert.equal(nodes[1]?.position.y, STORYBOARD_ZONE.y + STORYBOARD_ROW_HEIGHT);
});

test("buildStoryboardSpawnGraph wires script to each storyboard cell", () => {
  const { nodes, edges } = buildStoryboardSpawnGraph("script-1", cells);
  assert.equal(edges.length, 3);
  for (const edge of edges) {
    assert.equal(edge.sourceNodeId, "script-1");
    assert.ok(nodes.some((node) => node.id === edge.targetNodeId));
  }
});
