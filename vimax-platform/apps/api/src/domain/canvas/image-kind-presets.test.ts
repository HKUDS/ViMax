import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_KIND_PRESETS,
  composeImagePrompt,
  getImageKindPreset,
} from "@vimax/contracts";

test("every image-kind preset has a unique kind, label, prompt and WxH size", () => {
  const kinds = new Set<string>();
  for (const p of IMAGE_KIND_PRESETS) {
    assert.ok(!kinds.has(p.kind), `duplicate kind ${p.kind}`);
    kinds.add(p.kind);
    assert.ok(p.label, `${p.kind} missing label`);
    assert.ok(p.prompt.trim().length > 0, `${p.kind} empty prompt`);
    assert.match(p.size, /^\d+x\d+$/, `${p.kind} size not WxH`);
  }
  assert.equal(IMAGE_KIND_PRESETS.length, 4, "expected portrait/environment/character_design/prop");
});

test("getImageKindPreset looks up by kind and returns undefined otherwise", () => {
  assert.equal(getImageKindPreset("portrait")?.label, "人物形象");
  assert.equal(getImageKindPreset("character_design")?.label, "角色设定");
  assert.equal(getImageKindPreset("generic"), undefined);
  assert.equal(getImageKindPreset("nope"), undefined);
  assert.equal(getImageKindPreset(undefined), undefined);
});

test("composeImagePrompt folds kind style before scene", () => {
  const out = composeImagePrompt("a young swordsman", "studio", "character_design");
  assert.ok(out.startsWith("a young swordsman"));
  assert.ok(out.indexOf("character design reference sheet") < out.indexOf("studio photography"));
});

test("composeImagePrompt falls back through kind then scene when base is empty", () => {
  const kindOnly = composeImagePrompt("", undefined, "portrait");
  assert.ok(kindOnly.includes("photorealistic portrait"));
  const both = composeImagePrompt("", "studio", "prop");
  assert.ok(both.indexOf("single prop asset") < both.indexOf("studio photography"));
});
