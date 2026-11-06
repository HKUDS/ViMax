import test from "node:test";
import assert from "node:assert/strict";
import { ImageEditInputSchema } from "@vimax/contracts";
import { planImageEdit } from "./edit.service.js";
import type { Asset } from "../../infrastructure/db/schema.js";

const MODEL = { id: "model-1", supports_reference: true };

function source(overrides: Partial<Asset> = {}): Pick<Asset, "storageKey" | "width" | "height" | "sha256"> {
  return {
    storageKey: "generated/source.png",
    width: 1024,
    height: 1024,
    sha256: "a".repeat(64),
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return ImageEditInputSchema.parse({
    source_asset_id: "0d8ee7b2-2c78-4e57-9f2a-3f9c8b1d6a10",
    edit_op: "replace_bg",
    prompt: "纯白电商背景",
    model_id: "model-1",
    ...overrides,
  });
}

// ── Schema ─────────────────────────────────────────────────────────

test("ImageEditInputSchema: remove_bg 免 prompt，其余 op 缺 prompt 报错", () => {
  const base = {
    source_asset_id: "0d8ee7b2-2c78-4e57-9f2a-3f9c8b1d6a10",
    model_id: "model-1",
  };
  assert.ok(ImageEditInputSchema.safeParse({ ...base, edit_op: "remove_bg" }).success);
  for (const edit_op of ["inpaint", "outpaint", "replace_bg"] as const) {
    assert.ok(!ImageEditInputSchema.safeParse({ ...base, edit_op }).success);
  }
});

test("ImageEditInputSchema: size 只接受 WxH 三到四位数字格式", () => {
  const base = {
    source_asset_id: "0d8ee7b2-2c78-4e57-9f2a-3f9c8b1d6a10",
    edit_op: "outpaint",
    prompt: "扩展画面",
    model_id: "model-1",
  };
  assert.ok(ImageEditInputSchema.safeParse({ ...base, size: "768x1344" }).success);
  assert.ok(!ImageEditInputSchema.safeParse({ ...base, size: "1024x1024x1" }).success);
  assert.ok(!ImageEditInputSchema.safeParse({ ...base, size: "any" }).success);
});

// ── planImageEdit ──────────────────────────────────────────────────

test("planImageEdit: 输出尺寸缺省取源图宽高，未知宽高回退 1024 方图", () => {
  assert.equal(planImageEdit(input(), MODEL, source()).size, "1024x1024");
  assert.equal(
    planImageEdit(input(), MODEL, source({ width: 768, height: 1344 })).size,
    "768x1344",
  );
  assert.equal(
    planImageEdit(input(), MODEL, source({ width: 0, height: 0 })).size,
    "1024x1024",
  );
  assert.equal(
    planImageEdit(input({ size: "1344x768" }), MODEL, source()).size,
    "1344x768",
  );
});

test("planImageEdit: 不支持参考图的模型被拒绝", () => {
  assert.throws(
    () => planImageEdit(input(), { id: "model-2", supports_reference: false }, source()),
    /input\.unsupported_model/,
  );
});

test("planImageEdit: payload 携带 source_storage_key 与 edit_op，快照记录 source_asset_id", () => {
  const plan = planImageEdit(input(), MODEL, source({ storageKey: "generated/x.png" }));
  assert.equal(plan.jobType, "image.edit");
  assert.equal(plan.payloadInput.source_storage_key, "generated/x.png");
  assert.equal(plan.payloadInput.edit_op, "replace_bg");
  assert.deepEqual(plan.payloadInput.reference_storage_keys, []);
  assert.equal(plan.inputSnapshot.source_asset_id, "0d8ee7b2-2c78-4e57-9f2a-3f9c8b1d6a10");
  assert.equal(plan.inputSnapshot.edit_op, "replace_bg");
});

test("planImageEdit: 缓存键随 edit_op / 源图内容变化，同参数稳定", () => {
  const a = planImageEdit(input(), MODEL, source());
  const b = planImageEdit(input(), MODEL, source());
  assert.equal(a.cacheKey, b.cacheKey);

  const otherOp = planImageEdit(input({ edit_op: "outpaint" }), MODEL, source());
  assert.notEqual(a.cacheKey, otherOp.cacheKey);

  const otherSource = planImageEdit(input(), MODEL, source({ sha256: "b".repeat(64) }));
  assert.notEqual(a.cacheKey, otherSource.cacheKey);
});

test("planImageEdit: remove_bg 无 prompt 时 payload prompt 为空串", () => {
  const plan = planImageEdit(input({ edit_op: "remove_bg", prompt: undefined }), MODEL, source());
  assert.equal(plan.payloadInput.prompt, "");
});
