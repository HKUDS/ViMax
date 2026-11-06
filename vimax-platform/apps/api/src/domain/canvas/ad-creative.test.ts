import assert from "node:assert/strict";
import test from "node:test";
import {
  AD_CTA_TYPES,
  AD_HOOK_TYPES,
  buildAdScriptPrompt,
  formatAdScript,
  getAdCtaType,
  getAdDurationPreset,
  getAdHookType,
  parseAdScript,
  type AdScript,
} from "@vimax/contracts";

// ── Duration presets ────────────────────────────────────────────────

test("15s preset shrinks to hook→solution→cta (no pain/proof beats)", () => {
  const preset = getAdDurationPreset(15);
  assert.deepEqual(preset.beats, ["hook", "solution", "cta"]);
});

test("30s and 60s presets expand pain; 60s adds proof", () => {
  assert.deepEqual(getAdDurationPreset(30).beats, ["hook", "pain", "solution", "cta"]);
  assert.deepEqual(getAdDurationPreset(60).beats, ["hook", "pain", "solution", "proof", "cta"]);
});

test("unknown duration falls back to the 30s standard preset", () => {
  assert.equal(getAdDurationPreset(45).durationSec, 30);
});

// ── Hook / CTA lookups ──────────────────────────────────────────────

test("hook and cta lookups resolve known ids and fall back for unknown", () => {
  assert.equal(getAdHookType("result_first").label, "效果前置");
  assert.equal(getAdHookType("nope").label, "痛点提问");
  assert.equal(getAdCtaType("limited_offer").label, "限时优惠");
  assert.equal(getAdCtaType(undefined).label, "限时优惠");
  assert.ok(AD_HOOK_TYPES.length >= 5);
  assert.ok(AD_CTA_TYPES.length >= 4);
});

// ── Prompt builder ──────────────────────────────────────────────────

test("buildAdScriptPrompt embeds product, hook template and JSON format", () => {
  const { system, prompt } = buildAdScriptPrompt({
    productDescription: "便携榨汁杯，Type-C 充电",
    sellingPoints: ["30 秒出汁", "Type-C 快充"],
    audience: "健身人群",
    durationSec: 15,
    hookType: "result_first",
    ctaType: "buy_now",
  });

  assert.ok(system.includes("黄金3秒"));
  assert.ok(system.includes("只输出一个 JSON"));
  assert.ok(prompt.includes("便携榨汁杯"));
  assert.ok(prompt.includes("30 秒出汁"));
  assert.ok(prompt.includes("健身人群"));
  assert.ok(prompt.includes("效果前置"));
  assert.ok(prompt.includes('"beats"'));
  // 15s must NOT ask for a pain beat.
  assert.ok(!prompt.includes("痛点激化"));
});

test("buildAdScriptPrompt auto-extracts selling points when absent", () => {
  const { prompt } = buildAdScriptPrompt({ productDescription: "一把好伞" });
  assert.ok(prompt.includes("自动提炼"));
});

// ── Parser ──────────────────────────────────────────────────────────

const RAW_AD = `下面是脚本：
\`\`\`json
{
  "title": "榨汁杯 15 秒",
  "hookType": "result_first",
  "ctaType": "buy_now",
  "beats": [
    { "beat": "hook", "startSec": 0, "endSec": 3, "voiceover": "看这个效果", "visual": "特写：果汁倾倒瞬间" },
    { "beat": "solution", "startSec": 3, "endSec": 11, "voiceover": "30秒出汁", "visual": "中景：手持榨汁杯演示" },
    { "beat": "nonsense", "startSec": 11, "endSec": 15, "voiceover": "链接在下方", "visual": "" }
  ],
  "sellingPoints": ["30 秒出汁"]
}
\`\`\``;

test("parseAdScript parses fenced JSON and normalizes unknown beats", () => {
  const ad = parseAdScript(RAW_AD, 15);

  assert.ok(ad);
  assert.equal(ad.title, "榨汁杯 15 秒");
  assert.equal(ad.hookType, "result_first");
  assert.equal(ad.ctaType, "buy_now");
  assert.equal(ad.beats.length, 3);
  assert.equal(ad.beats[2].beat, "solution");
});

test("parseAdScript returns null for non-JSON output", () => {
  assert.equal(parseAdScript("纯文本脚本，没有 JSON"), null);
  assert.equal(parseAdScript('{"title": "空脚本"}'), null);
});

// ── Formatter ───────────────────────────────────────────────────────

test("formatAdScript renders storyboard-ready blocks per beat", () => {
  const ad: AdScript = {
    title: "测试广告",
    durationSec: 15,
    hookType: "pain_question",
    ctaType: "learn_more",
    sellingPoints: ["快", "便宜"],
    beats: [
      { beat: "hook", startSec: 0, endSec: 3, voiceover: "还在烦恼？", visual: "特写：皱眉的脸" },
      { beat: "cta", startSec: 12, endSec: 15, voiceover: "点下方链接", visual: "商品居中" },
    ],
  };

  const text = formatAdScript(ad);
  assert.ok(text.includes("【广告脚本】测试广告（15 秒 · 痛点提问钩子 · 点击了解）"));
  assert.ok(text.includes("【卖点】快；便宜"));
  assert.ok(text.includes("【钩子 0-3秒】"));
  assert.ok(text.includes("画面：特写：皱眉的脸"));
  assert.ok(text.includes("口播：点下方链接"));
});
