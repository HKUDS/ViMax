import test from "node:test";
import assert from "node:assert/strict";
import { resolveImageModelForMode, type ResolvedImageModel } from "./node-executor.service.js";

const t2iOnly = (id: string): ResolvedImageModel => ({
  id,
  class_path: "tools.ImageGeneratorCogViewZhipuAPI",
  supports_reference: false,
});

const refCapable = (id: string): ResolvedImageModel => ({
  id,
  class_path: "tools.ImageGeneratorQwenImageEditModelScopeAPI",
  supports_reference: true,
});

async function withFallbackEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.DEFAULT_I2I_IMAGE_MODEL;
  if (value === undefined) delete process.env.DEFAULT_I2I_IMAGE_MODEL;
  else process.env.DEFAULT_I2I_IMAGE_MODEL = value;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.DEFAULT_I2I_IMAGE_MODEL;
    else process.env.DEFAULT_I2I_IMAGE_MODEL = prev;
  }
}

test("resolveImageModelForMode: t2i 不触发回退", async () => {
  let resolves = 0;
  const resolve = async (id?: string) => {
    resolves++;
    return t2iOnly(id ?? "cogview-3-flash");
  };
  await withFallbackEnv("modelscope-qwen-image-edit", async () => {
    const model = await resolveImageModelForMode("cogview-3-flash", "t2i", resolve);
    assert.equal(model.id, "cogview-3-flash");
  });
  assert.equal(resolves, 1);
});

test("resolveImageModelForMode: i2i 且模型已支持参考图时原样返回", async () => {
  const model = await resolveImageModelForMode(
    "modelscope-qwen-image-edit",
    "i2i",
    async () => refCapable("modelscope-qwen-image-edit"),
  );
  assert.equal(model.id, "modelscope-qwen-image-edit");
});

test("resolveImageModelForMode: i2i 且模型不支持时回退到 DEFAULT_I2I_IMAGE_MODEL", async () => {
  const model = await withFallbackEnv("modelscope-qwen-image-edit", () =>
    resolveImageModelForMode(
      "cogview-3-flash",
      "i2i",
      async (id) =>
        id === "modelscope-qwen-image-edit"
          ? refCapable(id)
          : t2iOnly(id ?? "cogview-3-flash"),
    ),
  );
  assert.equal(model.id, "modelscope-qwen-image-edit");
  assert.ok(model.supports_reference);
});

test("resolveImageModelForMode: 回退档也不支持参考图时保持原模型（由调用方报错）", async () => {
  const model = await withFallbackEnv("modelscope-qwen-image", () =>
    resolveImageModelForMode(
      "cogview-3-flash",
      "i2i",
      async (id) => t2iOnly(id ?? "cogview-3-flash"),
    ),
  );
  assert.equal(model.id, "cogview-3-flash");
  assert.equal(model.supports_reference, false);
});

test("resolveImageModelForMode: 未配置回退档时保持原模型", async () => {
  let resolves = 0;
  const model = await withFallbackEnv(undefined, () =>
    resolveImageModelForMode("cogview-3-flash", "i2i", async (id) => {
      resolves++;
      return t2iOnly(id ?? "cogview-3-flash");
    }),
  );
  assert.equal(model.id, "cogview-3-flash");
  assert.equal(resolves, 1);
});

test("resolveImageModelForMode: 回退档与已解析模型相同时不重复解析", async () => {
  let resolves = 0;
  const model = await withFallbackEnv("cogview-3-flash", () =>
    resolveImageModelForMode(undefined, "i2i", async (id) => {
      resolves++;
      return t2iOnly(id ?? "cogview-3-flash");
    }),
  );
  assert.equal(model.id, "cogview-3-flash");
  assert.equal(resolves, 1);
});
