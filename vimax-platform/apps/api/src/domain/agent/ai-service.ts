// ── AI Abstraction Layer ─────────────────────────────────────────────
// Adapted from Toonflow's utils/ai.ts — provides a unified interface
// for text/image/video/audio generation across multiple providers.

import { z } from "zod";

// ── Configuration ───────────────────────────────────────────────────

export interface AIProviderConfig {
  id: string;
  name: string;
  type: "openai" | "anthropic" | "google" | "custom";
  baseUrl: string;
  apiKey: string;
  models: AIModelConfig[];
}

export interface AIModelConfig {
  id: string;
  name: string;
  type: "chat" | "image" | "video" | "tts" | "embedding";
  maxTokens?: number;
  supportsThinking?: boolean;
  supportsVision?: boolean;
  supportsStreaming?: boolean;
}

// ── Fetch with retry (transient provider/network errors) ───────────
// AI providers (and the network to them) occasionally drop a connection
// or return 5xx/429. Retrying these — but never 4xx client errors — keeps
// the agent pipeline from aborting on a single flaky call.

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 || res.status === 429) {
        throw new Error(`AI provider responded ${res.status}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < attempts - 1) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("AI fetch failed");
}

// ── Request timeout ─────────────────────────────────────────────────
// Without a deadline a stalled provider (connected but silent) would keep
// a chat turn pending forever — the assistant message stays "streaming"
// and the agent loop never advances.

const GENERATE_TIMEOUT_MS = 120_000;
const STREAM_TIMEOUT_MS = 300_000;

function withTimeout(abortSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout;
}

// ── AI Text Generation ──────────────────────────────────────────────

/**
 * Multimodal content part (OpenAI chat format) — text or image reference.
 * Vision calls pass images as data URLs so no public asset URLs are needed.
 */
export interface AIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

/**
 * OpenAI-compatible chat message. `tool` messages carry one tool result
 * (matched to a prior assistant `tool_calls` entry via `tool_call_id`) —
 * this is what makes the agent loop a real feedback loop instead of
 * re-prompting with hardcoded instructions.
 */
export interface AIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | AIContentPart[];
  /** Present on assistant messages that requested tool execution. */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  /** Present on role:"tool" messages. */
  tool_call_id?: string;
}

export interface AIUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface AITextRequest {
  /** System prompt */
  system?: string;
  /** Messages array (for multi-turn); may include the system role. */
  messages?: AIMessage[];
  /** Single user prompt (shortcut, creates messages array) */
  prompt?: string;
  /** Model ID (vendor:model format) */
  model?: string;
  /** Temperature 0-1 */
  temperature?: number;
  /** Max output tokens */
  maxTokens?: number;
  /** Enable thinking/reasoning */
  think?: boolean;
  /** Thinking depth 0-3 */
  thinkLevel?: 0 | 1 | 2 | 3;
  /** Tools the model can call */
  tools?: Record<string, AIToolDefinition>;
  /** Ask the provider to report token usage on streamed responses. */
  includeUsage?: boolean;
  /** Abort signal */
  abortSignal?: AbortSignal;
}

export interface AIToolDefinition {
  description: string;
  parameters: z.ZodType<unknown>;
}

export interface AITextResponse {
  text: string;
  thinking?: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result?: unknown;
  }>;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}

export interface AIStreamChunk {
  type: "text-delta" | "thinking-start" | "thinking-delta" | "thinking-end" |
    "tool-call" | "tool-result" | "error" | "done";
  text?: string;
  thinking?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  /** Provider tool-call id — the agent loop echoes it back on role:"tool". */
  toolCallId?: string;
  toolResult?: unknown;
  error?: string;
  thinkDurationMs?: number;
  /** Token usage (only on "done", only when includeUsage was requested). */
  usage?: AIUsage;
}

// ── OpenAI-compatible stream accumulator ────────────────────────────
// Tool-call arguments arrive fragmented across many SSE chunks (each
// carries a partial `arguments` string keyed by `index`). Accumulating
// them by index and assembling at stream end is the only correct way —
// parsing each chunk independently throws away every call. Extracted as
// a pure class so the fragmentation logic is unit-testable.

interface PendingToolCall {
  index: number;
  id?: string;
  name?: string;
  args: string;
}

export class OpenAiStreamAccumulator {
  private pending = new Map<number, PendingToolCall>();
  private thinkingStart = 0;

  /** Process one streamed choice; returns immediate text/thinking chunks. */
  feedChoice(choice: {
    delta?: {
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<Record<string, unknown>>;
    };
    finish_reason?: string | null;
  }): AIStreamChunk[] {
    const out: AIStreamChunk[] = [];
    const delta = choice.delta;

    if (delta?.reasoning_content) {
      if (!this.thinkingStart) {
        this.thinkingStart = Date.now();
        out.push({ type: "thinking-start" });
      }
      out.push({ type: "thinking-delta", thinking: delta.reasoning_content });
    }
    if (delta?.content) {
      out.push({ type: "text-delta", text: delta.content });
    }
    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = (tc.index as number) ?? 0;
        const fn = tc.function as Record<string, unknown> | undefined;
        let entry = this.pending.get(idx);
        if (!entry) {
          entry = { index: idx, args: "" };
          this.pending.set(idx, entry);
        }
        if (fn?.name) entry.name = fn.name as string;
        if (tc.id) entry.id = tc.id as string;
        if (typeof fn?.arguments === "string") entry.args += fn.arguments;
      }
    }
    if (choice.finish_reason && this.thinkingStart) {
      out.push({ type: "thinking-end", thinkDurationMs: Date.now() - this.thinkingStart });
      this.thinkingStart = 0;
    }
    return out;
  }

  /** Assemble accumulated tool calls (call at stream end / [DONE]). */
  flush(): AIStreamChunk[] {
    const out: AIStreamChunk[] = [];
    const entries = [...this.pending.entries()].sort((a, b) => a[0] - b[0]);
    for (const [, entry] of entries) {
      if (!entry.name) continue;
      let args: Record<string, unknown> = {};
      try {
        args = entry.args.trim() ? JSON.parse(entry.args) : {};
      } catch {
        // Malformed accumulated arguments — best-effort empty payload.
      }
      out.push({
        type: "tool-call",
        toolName: entry.name,
        toolArgs: args,
        ...(entry.id ? { toolCallId: entry.id } : {}),
      });
    }
    this.pending.clear();
    return out;
  }
}

// ── AI Service ──────────────────────────────────────────────────────

/**
 * Generate text using the configured AI provider.
 * Currently supports OpenAI-compatible APIs (Doubao, DeepSeek, etc.)
 */
export async function generateText(request: AITextRequest): Promise<AITextResponse> {
  const config = await resolveProviderConfig(request.model);
  if (!config) {
    throw new Error(`No provider configured for model: ${request.model ?? "default"}`);
  }

  const messages = buildMessages(request);
  const body = buildRequestBody(request, messages, false, config);

  const response = await fetchWithRetry(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: withTimeout(request.abortSignal, GENERATE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`AI API error (${response.status}): ${error}`);
  }

  const data = await response.json() as Record<string, unknown>;
  const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
  const message = choice?.message as Record<string, unknown> | undefined;

  return {
    text: contentToText(message?.content),
    thinking: message?.reasoning_content as string | undefined,
    usage: data.usage
      ? {
          promptTokens: (data.usage as Record<string, number>).prompt_tokens ?? 0,
          completionTokens: (data.usage as Record<string, number>).completion_tokens ?? 0,
        }
      : undefined,
  };
}

/** Vision models reply with content parts when images were sent — flatten. */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p): p is { type: "text"; text: string } => p?.type === "text")
      .map((p) => p.text)
      .join("");
  }
  return "";
}

/**
 * Embed one text via the provider's /embeddings endpoint. Throws when the
 * provider doesn't serve embeddings — callers degrade to lexical search.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const config = await resolveProviderConfig();
  if (!config) {
    throw new Error("No provider configured for embeddings");
  }
  const model = process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small";

  const response = await fetchWithRetry(`${config.baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({ model, input: text.slice(0, 8000) }),
    signal: withTimeout(undefined, GENERATE_TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding API error (${response.status}): ${error}`);
  }

  const data = await response.json() as { data?: Array<{ embedding?: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error("Embedding API returned no vector");
  }
  return embedding;
}

/**
 * Stream text generation using the configured AI provider.
 * Returns an async generator that yields chunks.
 */
export async function* streamText(
  request: AITextRequest,
): AsyncGenerator<AIStreamChunk> {
  const config = await resolveProviderConfig(request.model);
  if (!config) {
    throw new Error(`No provider configured for model: ${request.model ?? "default"}`);
  }

  const messages = buildMessages(request);
  const body = buildRequestBody(request, messages, true, config);

  const response = await fetchWithRetry(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: withTimeout(request.abortSignal, STREAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    const error = await response.text();
    yield { type: "error", error: `AI API error (${response.status}): ${error}` };
    return;
  }

  if (!response.body) {
    yield { type: "error", error: "No response body for streaming" };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const acc = new OpenAiStreamAccumulator();
  let usage: AIUsage | undefined;

  const flushEnd = async function* () {
    for (const chunk of acc.flush()) yield chunk;
    yield { type: "done" as const, ...(usage ? { usage } : {}) };
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") {
          yield* flushEnd();
          return;
        }

        try {
          const parsed = JSON.parse(data) as Record<string, unknown>;
          // include_usage responses arrive as a choice-less chunk carrying
          // the cumulative token counts right before [DONE].
          const rawUsage = parsed.usage as Record<string, number> | undefined;
          if (rawUsage) {
            usage = {
              promptTokens: rawUsage.prompt_tokens ?? 0,
              completionTokens: rawUsage.completion_tokens ?? 0,
            };
          }
          const choice = (parsed.choices as Array<Record<string, unknown>>)?.[0];
          if (!choice) continue;
          for (const chunk of acc.feedChoice(choice)) yield chunk;
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }
    // Stream ended without an explicit [DONE] — flush anyway.
    yield* flushEnd();
  } finally {
    reader.releaseLock();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function buildMessages(request: AITextRequest): AIMessage[] {
  if (request.messages) {
    return request.system
      ? [{ role: "system", content: request.system }, ...request.messages]
      : request.messages;
  }
  const msgs: AIMessage[] = [];
  if (request.system) msgs.push({ role: "system", content: request.system });
  if (request.prompt) msgs.push({ role: "user", content: request.prompt });
  return msgs;
}

function buildRequestBody(
  request: AITextRequest,
  messages: AIMessage[],
  stream: boolean,
  config: AIProviderConfig | null,
): Record<string, unknown> {
  const modelId = request.model?.includes(":")
    ? request.model!.split(":").slice(1).join(":")
    : config?.models[0]?.id ?? request.model ?? "default";

  const body: Record<string, unknown> = {
    model: modelId,
    messages,
    stream,
    temperature: request.temperature ?? 0.7,
    max_tokens: request.maxTokens ?? 4096,
  };

  if (stream && request.includeUsage) {
    body.stream_options = { include_usage: true };
  }

  // Tool definitions (OpenAI function calling format)
  if (request.tools && Object.keys(request.tools).length > 0) {
    body.tools = Object.entries(request.tools).map(([name, tool]) => ({
      type: "function",
      function: {
        name,
        description: tool.description,
        parameters: zodToJsonSchema(tool.parameters),
      },
    }));
  }

  return body;
}

/**
 * Resolve provider config from a model reference.
 * Priority: the user's selected model (a models-table row id) > the
 * user-configured default text row > environment variables.
 */
async function resolveProviderConfig(model?: string): Promise<AIProviderConfig | null> {
  // DB rows to consult: the explicitly selected one, then the tenant default.
  let selected: TextModelSource | null = null;
  let defaultModel: TextModelSource | null = null;
  try {
    const modelService = await import("../model/model.service.js");
    const requested = model?.trim() || undefined;
    if (requested) selected = await modelService.getModelById(requested);
    try { defaultModel = await modelService.getDefaultModel("default", "text"); } catch {}
  } catch {
    // DB not available yet, fall through to env vars
  }

  const resolved = resolveTextModelSelection(model, selected, defaultModel, {
    baseUrl: process.env.AI_BASE_URL ?? process.env.OPENAI_BASE_URL,
    apiKey: process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ARK_API_KEY,
  });
  if (!resolved) return null;

  return {
    id: "default",
    name: "Default Provider",
    type: "openai",
    baseUrl: resolved.baseUrl,
    apiKey: resolved.apiKey,
    models: [
      {
        id: resolved.modelId,
        name: resolved.modelId,
        type: "chat",
        supportsStreaming: true,
        supportsThinking: true,
      },
    ],
  };
}

// ── Text model priority resolution (pure, unit-testable) ────────────

export interface TextModelSource {
  apiKey?: string | null;
  baseUrl?: string | null;
  vendorModelId?: string | null;
  config?: Record<string, unknown> | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sourceBaseUrl(source: TextModelSource | null): string | undefined {
  const cfg = (source?.config ?? {}) as Record<string, unknown>;
  const initArgs = (cfg.init_args ?? {}) as Record<string, string | undefined>;
  return source?.baseUrl ?? (cfg.base_url as string | undefined) ?? initArgs.base_url ?? undefined;
}

/**
 * 用户选择 > 用户配置的默认行 > 环境变量。凭据(baseUrl/apiKey)取自
 * 选中行,缺项时逐字段回退 env;模型 id 取选中行 vendorModelId,其次
 * 显式模型串（"vendor:model" 取冒号后部分,裸 id 原样）,最后默认行。
 */
export function resolveTextModelSelection(
  model: string | undefined,
  selected: TextModelSource | null,
  fallback: TextModelSource | null,
  env: { baseUrl?: string; apiKey?: string },
): { baseUrl: string; apiKey: string; modelId: string } | null {
  const requested = model?.trim() || undefined;
  const credentialSource = selected ?? fallback;
  const baseUrl = sourceBaseUrl(credentialSource) ?? env.baseUrl;
  const apiKey = credentialSource?.apiKey || env.apiKey;
  if (!baseUrl || !apiKey) return null;

  // A selected row's id is a UUID — never send it to the provider as a model id.
  const explicitModel =
    requested && !UUID_RE.test(requested)
      ? requested.includes(":")
        ? requested.split(":").slice(1).join(":")
        : requested
      : undefined;

  const modelId =
    selected?.vendorModelId ||
    explicitModel ||
    fallback?.vendorModelId ||
    "default";

  return { baseUrl, apiKey, modelId };
}

/**
 * Minimal Zod-to-JSON-Schema converter.
 * Only handles the types used in tool parameter definitions.
 */
function zodToJsonSchema(zodType: z.ZodType<unknown>): Record<string, unknown> {
  if (zodType instanceof z.ZodObject) {
    const shape = zodType.shape as Record<string, z.ZodType<unknown>>;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(value);
      // Check if optional
      if (!(value instanceof z.ZodOptional)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  if (zodType instanceof z.ZodString) return { type: "string" };
  if (zodType instanceof z.ZodNumber) return { type: "number" };
  if (zodType instanceof z.ZodBoolean) return { type: "boolean" };
  if (zodType instanceof z.ZodArray) {
    return { type: "array", items: zodToJsonSchema(zodType.element) };
  }
  if (zodType instanceof z.ZodEnum) return { type: "string", enum: zodType.options };
  if (zodType instanceof z.ZodOptional) return zodToJsonSchema(zodType.unwrap());
  if (zodType instanceof z.ZodDefault) return zodToJsonSchema(zodType._def.innerType);

  return { type: "string" };
}
