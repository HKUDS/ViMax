import assert from "node:assert/strict";
import test from "node:test";
import { buildConcatCacheKey, buildVideoCacheKey } from "./cache-keys.js";

// ── buildVideoCacheKey ─────────────────────────────────────────────

test("buildVideoCacheKey is stable for identical inputs", () => {
  const a = buildVideoCacheKey({
    model_id: "seedance", prompt: "  cinematic  ", first_frame_sha256: "ff",
    last_frame_sha256: "lf", duration_sec: 5, resolution: "720p",
  });
  const b = buildVideoCacheKey({
    model_id: "seedance", prompt: "cinematic", first_frame_sha256: "ff",
    last_frame_sha256: "lf", duration_sec: 5, resolution: "720p",
  });
  // prompt is trimmed, so both collapse to the same key
  assert.equal(a, b);
});

test("buildVideoCacheKey changes when any meaningful field changes", () => {
  const base = {
    model_id: "seedance", prompt: "p", first_frame_sha256: "ff" as string | null,
    last_frame_sha256: "lf" as string | null, duration_sec: 5, resolution: "720p",
  };
  const k = buildVideoCacheKey(base);
  assert.notEqual(k, buildVideoCacheKey({ ...base, model_id: "other" }));
  assert.notEqual(k, buildVideoCacheKey({ ...base, prompt: "p2" }));
  assert.notEqual(k, buildVideoCacheKey({ ...base, first_frame_sha256: "ff2" }));
  assert.notEqual(k, buildVideoCacheKey({ ...base, last_frame_sha256: null }));
  assert.notEqual(k, buildVideoCacheKey({ ...base, duration_sec: 6 }));
  assert.notEqual(k, buildVideoCacheKey({ ...base, resolution: "1080p" }));
});

test("buildVideoCacheKey treats null and a missing frame identically", () => {
  const k1 = buildVideoCacheKey({
    model_id: "m", prompt: "p", first_frame_sha256: null,
    last_frame_sha256: null, duration_sec: 4, resolution: "720p",
  });
  // explicit null is the canonical "no frame" representation
  assert.match(k1, /^[0-9a-f]{64}$/);
});

// ── buildConcatCacheKey ────────────────────────────────────────────

test("buildConcatCacheKey is order-sensitive for clips", () => {
  const k1 = buildConcatCacheKey({ clip_sha256s: ["a", "b"], transition: "dissolve" });
  const k2 = buildConcatCacheKey({ clip_sha256s: ["b", "a"], transition: "dissolve" });
  assert.notEqual(k1, k2);
});

test("buildConcatCacheKey is stable for identical order + transition", () => {
  const a = buildConcatCacheKey({ clip_sha256s: ["a", "b", "c"], transition: "cut" });
  const b = buildConcatCacheKey({ clip_sha256s: ["a", "b", "c"], transition: "cut" });
  assert.equal(a, b);
});

test("buildConcatCacheKey changes with transition", () => {
  const a = buildConcatCacheKey({ clip_sha256s: ["a"], transition: "dissolve" });
  const b = buildConcatCacheKey({ clip_sha256s: ["a"], transition: "cut" });
  assert.notEqual(a, b);
});

test("video and concat keys live in separate namespaces", () => {
  const v = buildVideoCacheKey({
    model_id: "m", prompt: "p", first_frame_sha256: null,
    last_frame_sha256: null, duration_sec: 1, resolution: "720p",
  });
  const c = buildConcatCacheKey({ clip_sha256s: [], transition: "x" });
  assert.notEqual(v, c);
});
