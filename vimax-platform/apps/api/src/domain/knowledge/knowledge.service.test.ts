import assert from "node:assert/strict";
import test from "node:test";
import { chunkText, rrfFuse } from "./knowledge.service.js";

// ── chunkText ────────────────────────────────────────────────────────

test("chunkText returns a single chunk for short text", () => {
  assert.deepEqual(chunkText("hello", 500, 50), ["hello"]);
  assert.deepEqual(chunkText("", 500, 50), []);
  assert.deepEqual(chunkText("   ", 500, 50), []);
});

test("chunkText keeps text exactly equal to size in one chunk", () => {
  const text = "x".repeat(500);
  assert.deepEqual(chunkText(text, 500, 50), [text]);
});

test("chunkText slides with overlap and never drops characters", () => {
  const text = "abcdefghij"; // 10 chars, size 4, overlap 2 → step 2
  const chunks = chunkText(text, 4, 2);
  assert.equal(chunks[0], "abcd");
  assert.equal(chunks[1], "cdef"); // overlap "cd"
  // every char is covered by at least one chunk
  const covered = chunks.some((c) => c.includes("j"));
  assert.ok(covered);
  // reassemble via first chunk + non-overlapping tails
  let rebuilt = chunks[0];
  for (const c of chunks.slice(1)) rebuilt += c.slice(2);
  assert.equal(rebuilt, text);
});

test("chunkText defaults to 500/50", () => {
  const text = "y".repeat(1100);
  const chunks = chunkText(text);
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((c) => c.length <= 500));
});

// ── rrfFuse ──────────────────────────────────────────────────────────

test("rrfFuse ranks items appearing in both lists first", () => {
  // a: rank 1 in both lists; b/c/d appear once → a must lead
  const fused = rrfFuse([
    [{ id: "a" }, { id: "b" }, { id: "c" }],
    [{ id: "a" }, { id: "d" }],
  ]);
  assert.deepEqual(fused.map((f) => f.id), ["a", "b", "d", "c"]);
  assert.ok(fused[0].score > fused[1].score);
});

test("rrfFuse scores follow the RRF formula and respect k", () => {
  const rankings = [
    [{ id: "a" }, { id: "b" }],
    [{ id: "a" }],
  ];
  const k = 60;
  const fused = rrfFuse(rankings, k);
  assert.ok(Math.abs(fused[0].score - (1 / (k + 1) + 1 / (k + 1))) < 1e-12);
  assert.ok(Math.abs(fused[1].score - 1 / (k + 2)) < 1e-12);

  // smaller k sharpens rank-1 advantage
  const sharp = rrfFuse(rankings, 1);
  assert.ok(sharp[0].score - sharp[1].score > fused[0].score - fused[1].score);
});

test("rrfFuse fuses multiple lists and sorts descending", () => {
  const fused = rrfFuse([
    [{ id: "x" }],
    [{ id: "y" }],
    [{ id: "x" }, { id: "y" }],
  ]);
  assert.deepEqual(fused.map((f) => f.id), ["x", "y"]);
  for (let i = 1; i < fused.length; i++) {
    assert.ok(fused[i - 1].score >= fused[i].score);
  }
});
