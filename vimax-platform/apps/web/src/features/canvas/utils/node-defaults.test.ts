import assert from "node:assert/strict";
import test from "node:test";
import {
  FALLBACK_IMAGE_MODEL_ID,
  FALLBACK_VIDEO_MODEL_ID,
  getDefaultNodeData,
} from "./node-defaults.js";

test("video node defaults to video model, not image model", () => {
  const data = getDefaultNodeData("video");

  assert.equal(data.modelId, FALLBACK_VIDEO_MODEL_ID);
  assert.notEqual(data.modelId, FALLBACK_IMAGE_MODEL_ID);
});

test("image node defaults to image model", () => {
  const data = getDefaultNodeData("image");

  assert.equal(data.modelId, FALLBACK_IMAGE_MODEL_ID);
});

test("getDefaultNodeData respects caller-provided model defaults", () => {
  const video = getDefaultNodeData("video", { videoModelId: "veo-yunwu" });
  const image = getDefaultNodeData("image", { imageModelId: "custom-image" });

  assert.equal(video.modelId, "veo-yunwu");
  assert.equal(image.modelId, "custom-image");
});

test("concat node has dissolve transition", () => {
  const data = getDefaultNodeData("concat");

  assert.equal(data.transition, "dissolve");
  assert.equal(data.status, "idle");
});

test("script node starts with empty content", () => {
  const data = getDefaultNodeData("script");

  assert.equal(data.content, "");
  assert.equal(data.status, "idle");
});
