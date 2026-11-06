import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_NEGATIVE_PROMPT,
  NEGATIVE_WORD_GROUPS,
  PROMPT_THESAURUS,
  composeImagePrompt,
  ImageGenerateInputSchema,
} from "@vimax/contracts";

// ── composeImagePrompt 负面词折叠 ──────────────────────────────────

test("composeImagePrompt folds the negative prompt as a trailing Avoid clause", () => {
  const out = composeImagePrompt("a red fox", undefined, undefined, "blurry, watermark");
  assert.ok(out.startsWith("a red fox"));
  assert.ok(out.endsWith("Avoid: blurry, watermark"));
});

test("composeImagePrompt keeps kind/scene order and appends Avoid last", () => {
  const out = composeImagePrompt("a swordsman", "studio", "portrait", "watermark");
  const avoidAt = out.lastIndexOf(", Avoid: watermark");
  const sceneAt = out.indexOf("professional studio photography");
  const kindAt = out.indexOf("photorealistic portrait");
  assert.ok(kindAt > 0 && sceneAt > kindAt, "kind fragment should precede scene fragment");
  assert.ok(avoidAt > sceneAt, "Avoid clause should come last");
});

test("composeImagePrompt omits the Avoid clause when the negative prompt is empty", () => {
  assert.equal(composeImagePrompt("a product", undefined, undefined, ""), "a product");
  assert.equal(composeImagePrompt("a product", undefined, undefined, "   "), "a product");
  assert.equal(composeImagePrompt("a product"), "a product");
  assert.ok(!composeImagePrompt("a product", "studio", undefined, "  ").includes("Avoid"));
});

test("negative prompt changes the composed prompt (and thus the cache key input)", () => {
  const without = composeImagePrompt("a cat", "studio");
  const withNeg = composeImagePrompt("a cat", "studio", undefined, "text");
  assert.notEqual(without, withNeg);
});

// ── 词库完整性 ─────────────────────────────────────────────────────

test("negative word groups have unique ids and non-empty bilingual words", () => {
  const groupIds = new Set<string>();
  const wordIds = new Set<string>();
  for (const g of NEGATIVE_WORD_GROUPS) {
    assert.ok(!groupIds.has(g.id), `duplicate group id ${g.id}`);
    groupIds.add(g.id);
    assert.ok(g.label, `${g.id} missing label`);
    assert.ok(g.words.length > 0, `${g.id} empty words`);
    for (const w of g.words) {
      assert.ok(!wordIds.has(w.id), `duplicate word id ${w.id}`);
      wordIds.add(w.id);
      assert.ok(w.label.trim(), `${w.id} missing label`);
      assert.ok(w.en.trim(), `${w.id} missing en fragment`);
    }
  }
  assert.ok(NEGATIVE_WORD_GROUPS.some((g) => g.videoOnly), "expected a video-only group");
});

test("DEFAULT_NEGATIVE_PROMPT only draws from quality and watermark groups", () => {
  const allowed = new Set(
    NEGATIVE_WORD_GROUPS.filter((g) => !g.videoOnly && g.id !== "anatomy").flatMap((g) =>
      g.words.map((w) => w.en),
    ),
  );
  for (const en of DEFAULT_NEGATIVE_PROMPT.split(",").map((s) => s.trim())) {
    assert.ok(allowed.has(en), `default negative "${en}" not in quality/watermark groups`);
  }
});

test("thesaurus dimensions have unique ids and bilingual words", () => {
  const dimIds = new Set<string>();
  const wordIds = new Set<string>();
  for (const d of PROMPT_THESAURUS) {
    assert.ok(!dimIds.has(d.id), `duplicate dimension id ${d.id}`);
    dimIds.add(d.id);
    assert.ok(d.label, `${d.id} missing label`);
    for (const w of d.words) {
      assert.ok(!wordIds.has(w.id), `duplicate thesaurus word id ${w.id}`);
      wordIds.add(w.id);
      assert.ok(w.label.trim() && w.en.trim(), `${w.id} missing label or en`);
    }
  }
});

// ── schema 解析 ────────────────────────────────────────────────────

test("ImageGenerateInputSchema accepts an optional negative_prompt", () => {
  const base = { mode: "t2i", prompt: "a cat", model_id: "m", size: "1024x1024" } as const;
  const without = ImageGenerateInputSchema.parse(base);
  assert.equal(without.negative_prompt, undefined);
  const withNeg = ImageGenerateInputSchema.parse({ ...base, negative_prompt: "blurry, text" });
  assert.equal(withNeg.negative_prompt, "blurry, text");
});

test("ImageGenerateInputSchema rejects an over-long negative_prompt", () => {
  const base = { mode: "t2i", prompt: "a cat", model_id: "m", size: "1024x1024" };
  assert.ok(!ImageGenerateInputSchema.safeParse({ ...base, negative_prompt: "x".repeat(1001) }).success);
});
