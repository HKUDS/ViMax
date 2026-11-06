import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanvasUrl,
  shouldSkipAppShell,
} from "./canvas-navigation.js";

test("buildCanvasUrl returns path without query when no params", () => {
  assert.equal(buildCanvasUrl("abc-123"), "/canvas/abc-123");
});

test("buildCanvasUrl encodes all model params", () => {
  const url = buildCanvasUrl("abc-123", {
    textModelId: "text-1",
    imageModelId: "img-1",
    videoModelId: "vid-1",
    prompt: "hello world",
    mode: "idea",
  });

  assert.equal(
    url,
    "/canvas/abc-123?textModelId=text-1&imageModelId=img-1&videoModelId=vid-1&prompt=hello+world&mode=idea",
  );
});

test("buildCanvasUrl omits empty params", () => {
  const url = buildCanvasUrl("abc-123", {
    videoModelId: "doubao-seedance-1-0-lite",
  });

  assert.equal(url, "/canvas/abc-123?videoModelId=doubao-seedance-1-0-lite");
});

test("shouldSkipAppShell is true for canvas routes", () => {
  assert.equal(shouldSkipAppShell("/canvas/abc-123"), true);
  assert.equal(shouldSkipAppShell("/canvas/"), true);
});

test("shouldSkipAppShell is false for other routes", () => {
  assert.equal(shouldSkipAppShell("/"), false);
  assert.equal(shouldSkipAppShell("/login"), false);
  assert.equal(shouldSkipAppShell("/settings/models"), false);
});
