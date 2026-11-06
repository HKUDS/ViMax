import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStoryboardUserRequirement,
  mapCanvasCharactersToPayload,
} from "./storyboard-input.js";

test("mapCanvasCharactersToPayload extracts character nodes", () => {
  const payload = mapCanvasCharactersToPayload([
    { type: "script", data: { content: "hello" } },
    { type: "character", data: { name: "Lila", description: "28岁晨跑者" } },
    { type: "character", data: { name: "Bob", description: "教练" } },
  ]);

  assert.deepEqual(payload, [
    { name: "Lila", description: "28岁晨跑者" },
    { name: "Bob", description: "教练" },
  ]);
});

test("buildStoryboardUserRequirement differs by mode", () => {
  assert.match(buildStoryboardUserRequirement("script"), /script closely/i);
  assert.match(buildStoryboardUserRequirement("idea"), /AI video pipeline/i);
});
