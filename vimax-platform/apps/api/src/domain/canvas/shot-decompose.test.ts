import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDecomposeUserPrompt,
  buildShotNodeData,
  normalizeVariationType,
  parseDecomposition,
} from "./shot-decompose.js";

// ── normalizeVariationType ─────────────────────────────────────────

test("normalizeVariationType passes through valid values", () => {
  assert.equal(normalizeVariationType("large"), "large");
  assert.equal(normalizeVariationType("medium"), "medium");
  assert.equal(normalizeVariationType("small"), "small");
});

test("normalizeVariationType coerces invalid values to medium", () => {
  assert.equal(normalizeVariationType("huge"), "medium");
  assert.equal(normalizeVariationType(undefined), "medium");
  assert.equal(normalizeVariationType(123), "medium");
});

// ── buildShotNodeData ──────────────────────────────────────────────

test("buildShotNodeData maps a complete decomposition onto a shot node", () => {
  const data = buildShotNodeData({
    ffDesc: "首帧",
    lfDesc: "末帧",
    motionDesc: "推进",
    audioDesc: "音效",
    variationType: "small",
  });
  assert.deepEqual(data, {
    ffDesc: "首帧",
    lfDesc: "末帧",
    motionDesc: "推进",
    audioDesc: "音效",
    variationType: "small",
    ffVisCharIdxs: [],
    lfVisCharIdxs: [],
  });
});

test("buildShotNodeData falls back to empty strings for missing fields", () => {
  const data = buildShotNodeData({});
  assert.equal(data.ffDesc, "");
  assert.equal(data.lfDesc, "");
  assert.equal(data.motionDesc, "");
  assert.equal(data.audioDesc, "");
});

test("buildShotNodeData leaves variation type unchanged when a valid one is given", () => {
  const data = buildShotNodeData({ variationType: "large" });
  assert.equal(data.variationType, "large");
});

// ── parseDecomposition ─────────────────────────────────────────────

test("parseDecomposition extracts the JSON object embedded in prose", () => {
  const text = `好的，结果如下：\n{"ff_desc":"ff","lf_desc":"lf","motion_desc":"pan","variation_type":"large"}\n完成`;
  const d = parseDecomposition(text);
  assert.equal(d?.ffDesc, "ff");
  assert.equal(d?.lfDesc, "lf");
  assert.equal(d?.motionDesc, "pan");
  assert.equal(d?.variationType, "large");
});

test("parseDecomposition returns null when no JSON is present", () => {
  assert.equal(parseDecomposition("no json here"), null);
});

test("parseDecomposition returns null on malformed JSON", () => {
  assert.equal(parseDecomposition("{broken"), null);
});

test("parseDecomposition defaults variation_type to medium when omitted", () => {
  const d = parseDecomposition('{"ff_desc":"a","lf_desc":"b","motion_desc":"c"}');
  assert.equal(d?.variationType, "medium");
});

test("parseDecomposition normalizes an invalid variation_type to medium", () => {
  const d = parseDecomposition('{"ff_desc":"a","lf_desc":"b","motion_desc":"c","variation_type":"huge"}');
  assert.equal(d?.variationType, "medium");
});

// ── buildDecomposeUserPrompt ───────────────────────────────────────

test("buildDecomposeUserPrompt includes the brief and omits audio when absent", () => {
  const p = buildDecomposeUserPrompt("角色走进房间");
  assert.ok(p.includes("角色走进房间"));
  assert.ok(!p.includes("音频"));
});

test("buildDecomposeUserPrompt appends the audio cue when provided", () => {
  const p = buildDecomposeUserPrompt("角色走进房间", "脚步声");
  assert.ok(p.includes("脚步声"));
});
