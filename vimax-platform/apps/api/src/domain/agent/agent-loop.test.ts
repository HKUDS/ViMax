import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_TOKEN_BUDGET,
  MAX_AGENT_STEPS,
  REPEATED_FAILURE_LIMIT,
  canonicalToolKey,
  isRepeatedFailure,
  toolResultMessage,
} from "./agent-loop.js";

// ── canonicalToolKey ────────────────────────────────────────────────

test("canonicalToolKey is independent of object key order", () => {
  const a = canonicalToolKey("generate_image", { prompt: "白底图", size: "1024x1024" });
  const b = canonicalToolKey("generate_image", { size: "1024x1024", prompt: "白底图" });
  assert.equal(a, b);
});

test("canonicalToolKey separates different tools and args", () => {
  const base = canonicalToolKey("run_node", { nodeId: "a" });
  assert.notEqual(base, canonicalToolKey("run_node", { nodeId: "b" }));
  assert.notEqual(base, canonicalToolKey("generate_image", { nodeId: "a" }));
  assert.notEqual(
    canonicalToolKey("generate_image", { refs: ["a", "b"] }),
    canonicalToolKey("generate_image", { refs: ["b", "a"] }),
  );
});

// ── repeated-failure circuit breaker ────────────────────────────────

test("isRepeatedFailure trips only at the limit", () => {
  const counts = new Map<string, number>();
  const key = canonicalToolKey("run_node", { nodeId: "x" });
  assert.equal(isRepeatedFailure(counts, key), false);
  assert.equal(isRepeatedFailure(counts, key), true);
  // Third identical attempt would also trip, but the loop already stopped.
  assert.equal(isRepeatedFailure(counts, key), true);
  assert.equal(REPEATED_FAILURE_LIMIT, 2);
});

test("isRepeatedFailure tracks keys independently", () => {
  const counts = new Map<string, number>();
  const k1 = canonicalToolKey("run_node", { nodeId: "x" });
  const k2 = canonicalToolKey("run_node", { nodeId: "y" });
  assert.equal(isRepeatedFailure(counts, k1), false);
  assert.equal(isRepeatedFailure(counts, k2), false);
  assert.equal(isRepeatedFailure(counts, k1), true);
});

// ── tool result feedback messages ───────────────────────────────────

test("toolResultMessage carries success, message and result", () => {
  const msg = toolResultMessage("call_1", {
    success: true,
    message: "已创建图片节点",
    result: { nodeId: "n1", size: "1024x1536" },
  });
  assert.equal(msg.role, "tool");
  assert.equal(msg.tool_call_id, "call_1");
  const parsed = JSON.parse(msg.content as string) as Record<string, unknown>;
  assert.equal(parsed.success, true);
  assert.equal(parsed.message, "已创建图片节点");
  assert.deepEqual(parsed.result, { nodeId: "n1", size: "1024x1536" });
});

test("toolResultMessage truncates oversized results", () => {
  const big = { blob: "x".repeat(10_000) };
  const msg = toolResultMessage("call_2", { success: true, message: "ok", result: big });
  assert.ok((msg.content as string).length < 2_000);
  const parsed = JSON.parse(msg.content as string) as Record<string, unknown>;
  assert.ok(String(parsed.result).includes("(truncated)"));
});

// ── budget constants sanity ─────────────────────────────────────────

test("loop budgets have sane bounds", () => {
  assert.equal(MAX_AGENT_STEPS, 8);
  assert.ok(AGENT_TOKEN_BUDGET > 0);
});
