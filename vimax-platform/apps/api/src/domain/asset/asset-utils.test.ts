import assert from "node:assert/strict";
import test from "node:test";
import { inferAssetKind, shouldCreateAsset } from "./asset-utils.js";

test("inferAssetKind returns video for video/mp4", () => {
  assert.equal(inferAssetKind("video/mp4"), "video");
});

test("inferAssetKind returns audio for audio/mpeg", () => {
  assert.equal(inferAssetKind("audio/mpeg"), "audio");
});

test("inferAssetKind returns image for image/png", () => {
  assert.equal(inferAssetKind("image/png"), "image");
});

test("shouldCreateAsset is false when cells are present", () => {
  assert.equal(
    shouldCreateAsset({ storage_key: "", cells: [{ shotBrief: "a", cameraIdx: 0 }] }),
    false,
  );
});

test("shouldCreateAsset is true when storage_key is set", () => {
  assert.equal(shouldCreateAsset({ storage_key: "generated/abc.mp4" }), true);
});

test("shouldCreateAsset is false for empty storage_key without cells", () => {
  assert.equal(shouldCreateAsset({ storage_key: "" }), false);
});
