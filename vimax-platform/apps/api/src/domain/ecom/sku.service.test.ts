import assert from "node:assert/strict";
import test from "node:test";
import { buildSkuSceneNodeData } from "./sku.service.js";

test("buildSkuSceneNodeData defaults to 1:1 and marks product kind", () => {
  const data = buildSkuSceneNodeData({
    scene: "白色棚拍背景",
    referenceAssetIds: ["a1"],
    seed: 42,
    modelId: "m1",
  });
  assert.equal(data.kind, "product");
  assert.equal(data.size, "1024x1024");
  assert.equal(data.aspectRatio, "sq-1-1");
  assert.equal(data.status, "idle");
  assert.equal(
    data.prompt,
    "白色棚拍背景, professional e-commerce product photography, consistent product identity across shots",
  );
});

test("buildSkuSceneNodeData maps aspect ratio presets to sizes", () => {
  const data = buildSkuSceneNodeData({
    scene: "s",
    aspectRatio: "pt-3-4",
    referenceAssetIds: [],
    seed: 1,
    modelId: "m",
  });
  assert.equal(data.size, "1024x1536");
  assert.equal(data.aspectRatio, "pt-3-4");

  // 未知比例回落 1:1
  const fallback = buildSkuSceneNodeData({
    scene: "s",
    aspectRatio: "xx-99",
    referenceAssetIds: [],
    seed: 1,
    modelId: "m",
  });
  assert.equal(fallback.size, "1024x1024");
});

test("buildSkuSceneNodeData truncates references to 4 and passes seed through", () => {
  const data = buildSkuSceneNodeData({
    scene: "s",
    referenceAssetIds: ["a", "b", "c", "d", "e", "f"],
    seed: 777,
    modelId: "m",
  });
  assert.deepEqual(data.referenceAssetIds, ["a", "b", "c", "d"]);
  assert.equal(data.seed, 777);
  assert.equal(data.modelId, "m");
});
