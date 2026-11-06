import assert from "node:assert/strict";
import test from "node:test";
import { extractTraceId, langfuseScoreEndpoint } from "./langfuse-score.js";

const VALID = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;

test("extractTraceId extracts the 32-hex trace id", () => {
  assert.equal(extractTraceId(VALID), "a".repeat(32));
});

test("extractTraceId returns null for malformed input", () => {
  assert.equal(extractTraceId(null), null);
  assert.equal(extractTraceId(undefined), null);
  assert.equal(extractTraceId(""), null);
  assert.equal(extractTraceId("00-short-span-01"), null);
  assert.equal(extractTraceId(`00-${"Z".repeat(32)}-${"b".repeat(16)}-01`), null);
});

test("langfuseScoreEndpoint is null without env config", () => {
  const prev = { ...process.env };
  delete process.env.LANGFUSE_HOST;
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;
  try {
    assert.equal(langfuseScoreEndpoint(), null);
  } finally {
    Object.assign(process.env, prev);
  }
});

test("langfuseScoreEndpoint builds url and basic auth when fully configured", () => {
  const prev = { ...process.env };
  process.env.LANGFUSE_HOST = "http://langfuse:3000/";
  process.env.LANGFUSE_PUBLIC_KEY = "pk";
  process.env.LANGFUSE_SECRET_KEY = "sk";
  try {
    const endpoint = langfuseScoreEndpoint();
    assert.equal(endpoint?.url, "http://langfuse:3000/api/public/scores");
    assert.equal(endpoint?.authorization, `Basic ${Buffer.from("pk:sk").toString("base64")}`);
  } finally {
    Object.assign(process.env, prev);
  }
});
