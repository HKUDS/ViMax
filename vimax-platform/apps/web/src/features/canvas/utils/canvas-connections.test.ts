import assert from "node:assert/strict";
import test from "node:test";
import { isValidConnectionType, RUNNABLE_NODE_TYPE_SET } from "@vimax/contracts";

test("canonical production chain connections are valid", () => {
  assert.equal(isValidConnectionType("script", "storyboard_cell"), true);
  assert.equal(isValidConnectionType("script", "character"), true);
  assert.equal(isValidConnectionType("character", "shot"), true);
  assert.equal(isValidConnectionType("storyboard_cell", "shot"), true);
  assert.equal(isValidConnectionType("shot", "image"), true);
  assert.equal(isValidConnectionType("image", "video"), true);
  assert.equal(isValidConnectionType("video", "concat"), true);
});

test("reference-style refinement edges are valid", () => {
  assert.equal(isValidConnectionType("image", "image"), true);
  assert.equal(isValidConnectionType("image", "shot"), true);
  assert.equal(isValidConnectionType("character", "image"), true);
  assert.equal(isValidConnectionType("shot", "shot"), true);
  assert.equal(isValidConnectionType("video", "video"), true);
});

test("connections that no executor consumes are rejected", () => {
  assert.equal(isValidConnectionType("concat", "image"), false);
  assert.equal(isValidConnectionType("concat", "video"), false);
  assert.equal(isValidConnectionType("image", "script"), false);
  assert.equal(isValidConnectionType("image", "character"), false);
  assert.equal(isValidConnectionType("storyboard_cell", "image"), false);
  assert.equal(isValidConnectionType("script", "image"), false);
});

test("unknown node types are rejected", () => {
  assert.equal(isValidConnectionType("unknown", "image"), false);
  assert.equal(isValidConnectionType("image", "unknown"), false);
  assert.equal(isValidConnectionType("", ""), false);
});

test("runnable set matches the executor switch (includes concat)", () => {
  for (const t of ["image", "character", "shot", "video", "concat"]) {
    assert.equal(RUNNABLE_NODE_TYPE_SET.has(t), true);
  }
  assert.equal(RUNNABLE_NODE_TYPE_SET.has("script"), false);
  assert.equal(RUNNABLE_NODE_TYPE_SET.has("storyboard_cell"), false);
});
