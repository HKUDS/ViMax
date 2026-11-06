import assert from "node:assert/strict";
import test from "node:test";
import { buildImageNodeData, buildNodeManifest, normalizeNodeData } from "./decision-layer.js";

test("normalizeNodeData keeps valid object payloads untouched", () => {
  const data = { prompt: "a dog", size: "1024x1024" };
  assert.deepEqual(normalizeNodeData("image", data), data);
});

test("normalizeNodeData maps a string payload into the node type's text field", () => {
  assert.deepEqual(normalizeNodeData("image", "一只金毛犬"), {
    prompt: "一只金毛犬",
    status: "idle",
  });
  assert.deepEqual(normalizeNodeData("shot", "镜头2：草地奔跑"), {
    ffDesc: "镜头2：草地奔跑",
    status: "idle",
  });
  assert.deepEqual(normalizeNodeData("script", "剧本正文"), {
    content: "剧本正文",
    status: "idle",
  });
  assert.deepEqual(normalizeNodeData("storyboard_cell", "远景，跟拍"), {
    shotBrief: "远景，跟拍",
    status: "idle",
  });
  assert.deepEqual(normalizeNodeData("character", "金毛犬豆包"), {
    description: "金毛犬豆包",
    status: "idle",
  });
});

test("normalizeNodeData falls back to an empty object for missing/unknown payloads", () => {
  assert.deepEqual(normalizeNodeData("video", undefined), {});
  assert.deepEqual(normalizeNodeData("video", "  "), {});
  assert.deepEqual(normalizeNodeData("video", ["镜头1"]), {});
  assert.deepEqual(normalizeNodeData("concat", null), {});
});

// ── buildImageNodeData（generate_image 工具参数 → 节点数据） ──────────

test("buildImageNodeData maps aspect ratio preset ids onto pixel sizes", () => {
  const { nodeData } = buildImageNodeData({ prompt: "商品白底图", aspect_ratio: "pt-3-4" }, "model-1");
  assert.equal(nodeData.size, "1024x1536");
  assert.equal(nodeData.aspectRatio, "pt-3-4");
  assert.equal(nodeData.modelId, "model-1");
});

test("buildImageNodeData falls back to 1:1 and keeps kind/scene/negative", () => {
  const { nodeData } = buildImageNodeData(
    { prompt: "模特图", kind: "model", scene: "clean-white", negative_prompt: "text, watermark", aspect_ratio: "bad-id" },
    "model-1",
  );
  assert.equal(nodeData.size, "1024x1024");
  assert.equal(nodeData.kind, "model");
  assert.equal(nodeData.scene, "clean-white");
  assert.equal(nodeData.negativePrompt, "text, watermark");
});

test("buildImageNodeData drops unknown kinds and clamps references to 4", () => {
  const refs = ["a1", "a2", "a3", "a4", "a5", "a6"];
  const { nodeData } = buildImageNodeData(
    { prompt: "x", kind: "not-a-kind", reference_asset_ids: refs },
    "model-1",
  );
  assert.equal(nodeData.kind, undefined);
  assert.deepEqual(nodeData.referenceAssetIds, ["a1", "a2", "a3", "a4"]);
});

test("buildImageNodeData clamps variants into 1-4 and trims the prompt", () => {
  assert.equal(buildImageNodeData({ prompt: " x ", variants: 99 }, "m").variants, 4);
  assert.equal(buildImageNodeData({ prompt: " x ", variants: 0 }, "m").variants, 1);
  assert.equal(buildImageNodeData({ prompt: " x ", variants: 2.7 }, "m").variants, 2);
  assert.equal(buildImageNodeData({ prompt: " x " }, "m").variants, 1);
  assert.equal(buildImageNodeData({ prompt: " x " }, "m").nodeData.prompt, "x");
});

// ── buildNodeManifest（画布资产清单） ────────────────────────────────

test("buildNodeManifest lists asset-bearing nodes first with their ids", () => {
  const manifest = buildNodeManifest([
    { id: "aaaaaaaa-0000", type: "script", status: "done", data: {} },
    { id: "bbbbbbbb-0000", type: "image", status: "done", outputAssetId: "asset-1", data: { prompt: "白色背景上的香水瓶" } },
    { id: "cccccccc-0000", type: "image", status: "idle", data: { prompt: "未生成的图" } },
  ]);
  assert.match(manifest, /asset-1/);
  assert.match(manifest, /bbbbbbbb/);
  assert.match(manifest, /香水瓶/);
  assert.ok(!manifest.includes("aaaaaaaa")); // script nodes without assets stay out
});

test("buildNodeManifest says so when there is nothing to reference", () => {
  assert.match(buildNodeManifest([]), /暂无可引用/);
});
