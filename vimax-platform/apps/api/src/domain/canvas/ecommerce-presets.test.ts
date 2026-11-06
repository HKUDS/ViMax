import assert from "node:assert/strict";
import test from "node:test";
import {
  ECOMMERCE_ASPECT_RATIOS,
  ECOMMERCE_SCENES,
  composeImagePrompt,
  getAspectRatioPreset,
  getScenePreset,
} from "@vimax/contracts";

test("every aspect-ratio preset has a unique id and a WxH size", () => {
  const ids = new Set<string>();
  for (const p of ECOMMERCE_ASPECT_RATIOS) {
    assert.ok(p.id, "missing id");
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    assert.match(p.size, /^\d+x\d+$/, `${p.id} size not WxH`);
    assert.ok(p.label, `${p.id} missing label`);
  }
  assert.ok(ECOMMERCE_ASPECT_RATIOS.length >= 4, "expected common e-commerce ratios");
});

test("every scene preset has a unique id and a non-empty prompt", () => {
  const ids = new Set<string>();
  for (const s of ECOMMERCE_SCENES) {
    assert.ok(!ids.has(s.id), `duplicate scene id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.prompt.trim().length > 0, `${s.id} empty prompt`);
  }
});

test("getAspectRatioPreset / getScenePreset look up by id and return undefined otherwise", () => {
  assert.ok(getAspectRatioPreset("sq-1-1"));
  assert.equal(getAspectRatioPreset("nope"), undefined);
  assert.ok(getScenePreset("studio"));
  assert.equal(getScenePreset("nope"), undefined);
});

test("aspect-ratio sizes encode the advertised ratio", () => {
  const byId = (id: string) => getAspectRatioPreset(id)!.size;
  const [w1, h1] = byId("sq-1-1").split("x").map(Number);
  assert.equal(w1, h1, "1:1 should be square");
  const [w9, h9] = byId("fv-9-16").split("x").map(Number);
  assert.ok(h9 > w9, "9:16 should be portrait");
  const [w16, h16] = byId("bn-16-9").split("x").map(Number);
  assert.ok(w16 > h16, "16:9 should be landscape");
});

test("composeImagePrompt appends the scene fragment", () => {
  const out = composeImagePrompt("red sneakers", "studio");
  assert.ok(out.startsWith("red sneakers"));
  assert.ok(out.includes("studio"));
  assert.ok(out.length > "red sneakers".length);
});

test("composeImagePrompt returns the trimmed prompt when no scene is set", () => {
  assert.equal(composeImagePrompt("  a product  "), "a product");
  assert.equal(composeImagePrompt("a product", undefined), "a product");
  assert.equal(composeImagePrompt("a product", "unknown-scene"), "a product");
});

test("composeImagePrompt falls back to the scene prompt when the base is empty", () => {
  const out = composeImagePrompt("", "studio");
  assert.ok(out.includes("studio"));
});
