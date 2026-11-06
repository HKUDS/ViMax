import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiStreamAccumulator, resolveTextModelSelection } from "./ai-service.js";

// ── text + thinking passthrough ────────────────────────────────────

test("feedChoice yields text deltas immediately", () => {
  const acc = new OpenAiStreamAccumulator();
  const out = acc.feedChoice({ delta: { content: "hello" } });
  assert.deepEqual(out, [{ type: "text-delta", text: "hello" }]);
});

test("feedChoice emits thinking-start once, then thinking-deltas", () => {
  const acc = new OpenAiStreamAccumulator();
  const a = acc.feedChoice({ delta: { reasoning_content: "hm" } });
  assert.equal(a[0]!.type, "thinking-start");
  assert.equal(a[1]!.type, "thinking-delta");
  const b = acc.feedChoice({ delta: { reasoning_content: " more" } });
  // no second thinking-start
  assert.equal(b[0]!.type, "thinking-delta");
});

// ── tool-call fragmentation (the bug this fixes) ───────────────────

test("flush assembles a tool call whose args were streamed in fragments", () => {
  const acc = new OpenAiStreamAccumulator();
  // First chunk: name + start of args (incomplete JSON).
  acc.feedChoice({
    delta: {
      tool_calls: [{
        index: 0,
        id: "call_1",
        function: { name: "generate_script", arguments: '{"prompt":"做一' },
      }],
    },
  });
  // Second chunk: continuation — no name, more args.
  acc.feedChoice({
    delta: {
      tool_calls: [{
        index: 0,
        function: { arguments: '个电商广告短视频"' },
      }],
    },
  });
  // Third chunk: closing brace.
  acc.feedChoice({
    delta: {
      tool_calls: [{ index: 0, function: { arguments: "}" } }],
    },
  });

  const flushed = acc.flush();
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0]!.type, "tool-call");
  assert.equal(flushed[0]!.toolName, "generate_script");
  assert.deepEqual(flushed[0]!.toolArgs, { prompt: "做一个电商广告短视频" });
});

test("flush assembles multiple concurrent tool calls by index", () => {
  const acc = new OpenAiStreamAccumulator();
  acc.feedChoice({ delta: { tool_calls: [{ index: 0, function: { name: "run_node", arguments: '{"nodeId":"a"' } }] } });
  acc.feedChoice({ delta: { tool_calls: [{ index: 1, function: { name: "run_node", arguments: '{"nodeId":"b"' } }] } });
  acc.feedChoice({ delta: { tool_calls: [{ index: 0, function: { arguments: "}" } }] } });
  acc.feedChoice({ delta: { tool_calls: [{ index: 1, function: { arguments: "}" } }] } });

  const flushed = acc.flush();
  assert.equal(flushed.length, 2);
  assert.equal(flushed[0]!.toolArgs!.nodeId, "a");
  assert.equal(flushed[1]!.toolArgs!.nodeId, "b");
});

test("flush yields nothing when no tool call name was ever received", () => {
  const acc = new OpenAiStreamAccumulator();
  acc.feedChoice({ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] } });
  assert.equal(acc.flush().length, 0);
});

test("flush carries the provider tool-call id for the loop to echo back", () => {
  const acc = new OpenAiStreamAccumulator();
  acc.feedChoice({
    delta: {
      tool_calls: [{ index: 0, id: "call_abc", function: { name: "generate_image", arguments: "{}" } }],
    },
  });
  assert.equal(acc.flush()[0]!.toolCallId, "call_abc");
});

test("flush omits toolCallId when the provider never sent one", () => {
  const acc = new OpenAiStreamAccumulator();
  acc.feedChoice({
    delta: { tool_calls: [{ index: 0, function: { name: "f", arguments: "{}" } }] },
  });
  assert.equal(acc.flush()[0]!.toolCallId, undefined);
});

test("flush is idempotent (clears pending)", () => {
  const acc = new OpenAiStreamAccumulator();
  acc.feedChoice({ delta: { tool_calls: [{ index: 0, function: { name: "f", arguments: "{}" } }] } });
  assert.equal(acc.flush().length, 1);
  assert.equal(acc.flush().length, 0);
});

test("finish_reason ends an open thinking span", () => {
  const acc = new OpenAiStreamAccumulator();
  acc.feedChoice({ delta: { reasoning_content: "x" } });
  const out = acc.feedChoice({ finish_reason: "stop" });
  assert.ok(out.some((c) => c.type === "thinking-end"));
});

// ── text model priority: 选择 > 默认行 > env ──────────────────────

const DEFAULT_ROW = {
  apiKey: "sk-default",
  baseUrl: "https://default.example.com/v1",
  vendorModelId: "gpt-5.4",
  config: {},
};

test("selected model row wins over the configured default row", () => {
  const selected = {
    apiKey: "sk-new",
    baseUrl: "https://new.example.com/v1",
    vendorModelId: "glm-4.7",
    config: {},
  };
  const resolved = resolveTextModelSelection(
    "a6ca5927-2d9e-4639-b073-d5e1198b4372",
    selected,
    DEFAULT_ROW,
    {},
  );
  assert.deepEqual(resolved, {
    baseUrl: "https://new.example.com/v1",
    apiKey: "sk-new",
    modelId: "glm-4.7",
  });
});

test("no selection falls back to the configured default row", () => {
  const resolved = resolveTextModelSelection(undefined, null, DEFAULT_ROW, {});
  assert.deepEqual(resolved, {
    baseUrl: "https://default.example.com/v1",
    apiKey: "sk-default",
    modelId: "gpt-5.4",
  });
});

test("explicit vendor:model string overrides the default row's model id", () => {
  const resolved = resolveTextModelSelection("openai:gpt-4o", null, DEFAULT_ROW, {});
  assert.equal(resolved!.modelId, "gpt-4o");
  // credentials still come from the configured row
  assert.equal(resolved!.apiKey, "sk-default");
});

test("a bare model string is used as the model id", () => {
  const resolved = resolveTextModelSelection("deepseek-chat", null, DEFAULT_ROW, {});
  assert.equal(resolved!.modelId, "deepseek-chat");
});

test("an unmatched UUID must never leak as the provider model id", () => {
  const resolved = resolveTextModelSelection(
    "a6ca5927-2d9e-4639-b073-d5e1198b4372",
    null,
    DEFAULT_ROW,
    {},
  );
  assert.equal(resolved!.modelId, "gpt-5.4");
});

test("selected row credentials fall back to env field by field", () => {
  const selected = { vendorModelId: "glm-4.7" };
  const resolved = resolveTextModelSelection(
    "a6ca5927-2d9e-4639-b073-d5e1198b4372",
    selected,
    DEFAULT_ROW,
    { baseUrl: "https://env.example.com/v1", apiKey: "sk-env" },
  );
  assert.deepEqual(resolved, {
    baseUrl: "https://env.example.com/v1",
    apiKey: "sk-env",
    modelId: "glm-4.7",
  });
});

test("env config is used when no DB row exists", () => {
  const resolved = resolveTextModelSelection(undefined, null, null, {
    baseUrl: "https://env.example.com/v1",
    apiKey: "sk-env",
  });
  assert.deepEqual(resolved, {
    baseUrl: "https://env.example.com/v1",
    apiKey: "sk-env",
    modelId: "default",
  });
});

test("returns null when nothing is configured", () => {
  assert.equal(resolveTextModelSelection(undefined, null, null, {}), null);
  assert.equal(
    resolveTextModelSelection(undefined, { vendorModelId: "x" }, null, {}),
    null,
  );
});

test("baseUrl is read from config.init_args when the column is empty", () => {
  const row = {
    vendorModelId: "m",
    apiKey: "k",
    config: { init_args: { base_url: "https://cfg.example.com/v1" } },
  };
  const resolved = resolveTextModelSelection(undefined, null, row, {});
  assert.equal(resolved!.baseUrl, "https://cfg.example.com/v1");
});
