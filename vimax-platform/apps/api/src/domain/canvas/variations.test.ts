import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_VARIANTS,
  appendVariant,
  isVariantJob,
  type VariantEntry,
} from "./variations.js";

const V = (assetId: string, jobId: string, index: number): VariantEntry => ({
  assetId,
  jobId,
  index,
});

test("appendVariant starts a new gallery from undefined", () => {
  assert.deepEqual(appendVariant(undefined, V("a", "j0", 0)), [V("a", "j0", 0)]);
});

test("appendVariant appends to an existing gallery", () => {
  const gallery = appendVariant(undefined, V("a", "j0", 0));
  const next = appendVariant(gallery, V("b", "j1", 1));
  assert.deepEqual(next, [V("a", "j0", 0), V("b", "j1", 1)]);
  // original is not mutated
  assert.equal(gallery.length, 1);
});

test("appendVariant drops the oldest when exceeding the cap", () => {
  let gallery: VariantEntry[] | undefined = undefined;
  for (let i = 0; i < MAX_VARIANTS + 3; i++) {
    gallery = appendVariant(gallery, V(`a${i}`, `j${i}`, i), MAX_VARIANTS);
  }
  assert.ok(gallery, "gallery should be populated");
  assert.equal(gallery.length, MAX_VARIANTS);
  // the first three (oldest) are gone
  assert.equal(gallery[0]!.assetId, "a3");
  assert.equal(gallery[gallery.length - 1]!.assetId, `a${MAX_VARIANTS + 2}`);
});

test("isVariantJob detects the variant marker", () => {
  assert.equal(isVariantJob({ _variant: { index: 0 } }), true);
  assert.equal(isVariantJob({ _variant: { index: 3 } }), true);
});

test("isVariantJob is false without a numeric index", () => {
  assert.equal(isVariantJob(undefined), false);
  assert.equal(isVariantJob({}), false);
  assert.equal(isVariantJob({ _variant: {} }), false);
  assert.equal(isVariantJob({ _variant: { index: "x" } }), false);
});
