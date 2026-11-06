import assert from "node:assert/strict";
import test from "node:test";
import {
  TraceRecorder,
  childTraceparent,
  makeTraceparent,
  newSpanId,
  newTraceId,
  parseTraceparent,
} from "./trace.js";

// ── traceparent format ──────────────────────────────────────────────

test("makeTraceparent produces a valid W3C header", () => {
  const tp = makeTraceparent(newTraceId(), newSpanId());
  const parts = tp.split("-");
  assert.equal(parts.length, 4);
  assert.equal(parts[0], "00");
  assert.match(parts[1]!, /^[0-9a-f]{32}$/);
  assert.match(parts[2]!, /^[0-9a-f]{16}$/);
  assert.equal(parts[3], "01");
});

test("parseTraceparent round-trips and rejects malformed input", () => {
  const traceId = newTraceId();
  const spanId = newSpanId();
  assert.deepEqual(parseTraceparent(makeTraceparent(traceId, spanId)), {
    traceId,
    spanId,
  });
  assert.equal(parseTraceparent(""), null);
  assert.equal(parseTraceparent("not-a-traceparent"), null);
  assert.equal(parseTraceparent("00-00000000000000000000000000000000-abc1234567890def-01"), null);
  assert.equal(parseTraceparent("01-abc1234567890abc1234567890abc123-abc1234567890def-01"), null);
});

test("childTraceparent keeps the trace id and derives a fresh root without a parent", () => {
  const parent = makeTraceparent(newTraceId(), newSpanId());
  const child = childTraceparent(parent);
  assert.equal(child.split("-")[1], parent.split("-")[1]);
  assert.notEqual(child.split("-")[2], parent.split("-")[2]);

  const root = childTraceparent(undefined);
  assert.match(root, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  const orphan = childTraceparent("garbage");
  assert.match(orphan, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
});

// ── span recording ──────────────────────────────────────────────────

test("flush posts ended spans to the Langfuse OTLP endpoint when configured", async () => {
  const host = "http://langfuse.local";
  process.env.LANGFUSE_HOST = host;
  process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
  process.env.LANGFUSE_SECRET_KEY = "sk-test";
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;

  try {
    const rootSpanId = newSpanId();
    const parent = makeTraceparent(newTraceId(), rootSpanId);
    const recorder = new TraceRecorder(parent, "chat.agent_loop");
    const span = recorder.startSpan("tool.generate_image", { tool: "generate_image" });
    span.end({ success: true });
    recorder.endRoot({ tool_calls_total: 1 });
    await recorder.flush();

    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `${host}/api/public/otel/v1/traces`);
    const spans = (calls[0]!.body.resourceSpans as Array<Record<string, unknown>>)[0] !== undefined
      ? (((calls[0]!.body.resourceSpans as Array<Record<string, unknown>>)[0]!.scopeSpans as Array<Record<string, unknown>>)[0]!.spans as Array<Record<string, unknown>>)
      : [];
    assert.equal(spans.length, 2);
    assert.equal(spans[0]!.name, "chat.agent_loop");
    assert.equal(spans[1]!.name, "tool.generate_image");
    assert.equal(spans[1]!.parentSpanId, rootSpanId);
    const attrs = spans[1]!.attributes as Array<{ key: string; value: Record<string, unknown> }>;
    assert.ok(attrs.some((a) => a.key === "tool" && a.value.stringValue === "generate_image"));
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.LANGFUSE_HOST;
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
  }
});

test("flush is a no-op without Langfuse config or ended spans", async () => {
  delete process.env.LANGFUSE_HOST;
  const recorder = new TraceRecorder(makeTraceparent(newTraceId(), newSpanId()), "op");
  recorder.startSpan("child"); // never ended
  await recorder.flush(); // must not throw, must not fetch
});

test("TraceRecorder accepts an invalid root traceparent without throwing", () => {
  const recorder = new TraceRecorder("garbage", "chat.agent_loop");
  const span = recorder.startSpan("agent.step");
  span.end();
});
