import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSrt,
  buildAdVariantsPrompt,
  parseAdVariants,
  pickVariantHookTypes,
  wrapSubtitleLine,
  type AdHookTypeId,
} from "@vimax/contracts";

// ── pickVariantHookTypes ────────────────────────────────────────────

test("pickVariantHookTypes excludes the base hook and caps at count", () => {
  const hooks = pickVariantHookTypes("pain_question", 3);
  assert.equal(hooks.length, 3);
  assert.ok(!hooks.includes("pain_question"));
  // Stable order: the remaining types in AD_HOOK_TYPES order.
  assert.deepEqual(hooks, ["counter_intuition", "result_first", "identity"]);
});

test("pickVariantHookTypes honours a preferred list and dedupes", () => {
  const hooks = pickVariantHookTypes("pain_question", 3, [
    "suspense",
    "suspense",
    "identity",
  ]);
  assert.deepEqual(hooks, ["suspense", "identity"]);
});

// ── Variants prompt / parser ────────────────────────────────────────

test("buildAdVariantsPrompt lists each requested hook with templates", () => {
  const { system, prompt } = buildAdVariantsPrompt(
    { productDescription: "便携榨汁杯" },
    null,
    ["counter_intuition", "identity"],
  );

  assert.ok(system.includes("只换钩子策略"));
  assert.ok(prompt.includes("生成 2 个钩子变体"));
  assert.ok(prompt.includes("counter_intuition（反常识"));
  assert.ok(prompt.includes("identity（身份认同"));
});

test("parseAdVariants aligns variants with expected hook order", () => {
  const raw = JSON.stringify({
    variants: [
      {
        hookType: "counter_intuition",
        title: "变体一",
        beats: [{ beat: "hook", startSec: 0, endSec: 3, voiceover: "别再乱买了", visual: "特写" }],
        sellingPoints: ["快"],
      },
      {
        title: "变体二",
        beats: [{ beat: "hook", startSec: 0, endSec: 3, voiceover: "宝子们", visual: "中景" }],
      },
    ],
  });

  const variants = parseAdVariants(raw, 15, ["counter_intuition", "identity"]);
  assert.equal(variants.length, 2);
  assert.equal(variants[0].hookType, "counter_intuition");
  // Second variant didn't echo its hookType — falls back to expected order.
  assert.equal(variants[1].hookType, "identity");
  assert.equal(variants[1].title, "变体二");
});

test("parseAdVariants returns empty for non-JSON output", () => {
  assert.deepEqual(parseAdVariants("没有 JSON", 30, ["identity" as AdHookTypeId]), []);
});

// ── SRT builder ─────────────────────────────────────────────────────

test("buildSrt renders numbered cues with timestamp ranges", () => {
  const srt = buildSrt([
    { startSec: 0, endSec: 3, text: "还在为___烦恼" },
    { startSec: 12, endSec: 15, text: "点下方链接" },
  ]);

  assert.ok(srt.includes("1\n00:00:00,000 --> 00:00:03,000\n还在为___烦恼"));
  assert.ok(srt.includes("2\n00:00:12,000 --> 00:00:15,000\n点下方链接"));
});

test("wrapSubtitleLine splits long text into two readable lines", () => {
  assert.deepEqual(wrapSubtitleLine("短句"), ["短句"]);
  const wrapped = wrapSubtitleLine("这一句话特别长需要拆分成两行来展示字幕效果", 10);
  assert.equal(wrapped.length, 2);
  assert.ok(wrapped[0].length <= 10);
});
