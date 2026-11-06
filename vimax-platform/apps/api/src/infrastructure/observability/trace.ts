// ── Trace context (pure, dependency-free) ────────────────────────────
//
// W3C traceparent generation/propagation plus a minimal OTLP/HTTP(JSON)
// exporter. The agent loop runs inside runWithTrace so every enqueue can
// stamp the active traceparent into its job payload — the Python worker
// extracts it and its spans join the same trace in Langfuse.
//
// Export is best-effort: without LANGFUSE_* env vars nothing is sent and
// the platform behaves exactly as before (traceparent still propagates,
// logs stay correlatable via trace ids).

import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../../config/env.js";

const TRACEPARSER_VERSION = "00";
const TRACE_FLAGS_SAMPLED = "01";

export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

export function makeTraceparent(traceId: string, spanId: string): string {
  return `${TRACEPARSER_VERSION}-${traceId}-${spanId}-${TRACE_FLAGS_SAMPLED}`;
}

export function parseTraceparent(traceparent: string): { traceId: string; spanId: string } | null {
  const parts = traceparent.trim().split("-");
  if (parts.length !== 4) return null;
  const [version, traceId, spanId, flags] = parts as [string, string, string, string];
  if (version !== TRACEPARSER_VERSION) return null;
  if (!/^[0-9a-f]{32}$/.test(traceId) || traceId === "0".repeat(32)) return null;
  if (!/^[0-9a-f]{16}$/.test(spanId) || spanId === "0".repeat(16)) return null;
  if (!/^[0-9a-f]{2}$/.test(flags)) return null;
  return { traceId, spanId };
}

/** Derive a child traceparent (same trace, fresh span) — or a fresh root
 * when no valid parent is given. */
export function childTraceparent(parent?: string): string {
  const parsed = parent ? parseTraceparent(parent) : null;
  return makeTraceparent(parsed?.traceId ?? newTraceId(), newSpanId());
}

// ── Ambient trace context ───────────────────────────────────────────

export interface TraceContext {
  traceparent: string;
  recorder: TraceRecorder;
}

const ambient = new AsyncLocalStorage<TraceContext>();

export function runWithTrace<T>(context: TraceContext, fn: () => T): T {
  return ambient.run(context, fn);
}

export function currentTrace(): TraceContext | undefined {
  return ambient.getStore();
}

export function currentTraceparent(): string | undefined {
  return ambient.getStore()?.traceparent;
}

/** Open a root span handle for the current trace (or a standalone trace
 * when called outside runWithTrace — spans still get recorded if the
 * caller flushes the returned recorder). */
export function startTrace(rootName: string): TraceContext {
  const traceparent = childTraceparent(currentTrace()?.traceparent);
  return { traceparent, recorder: new TraceRecorder(traceparent, rootName) };
}

// ── Span recording + OTLP export ────────────────────────────────────

interface SpanRecord {
  name: string;
  spanId: string;
  parentSpanId?: string;
  traceId: string;
  startMs: number;
  endMs?: number;
  attributes: Record<string, string | number | boolean>;
}

type OtelAttrValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean };

function toOtelAttributes(attrs: Record<string, string | number | boolean>): Array<{ key: string; value: OtelAttrValue }> {
  return Object.entries(attrs).map(([key, value]) => ({
    key,
    value:
      typeof value === "number" ? { doubleValue: value }
      : typeof value === "boolean" ? { boolValue: value }
      : { stringValue: value },
  }));
}

function toUnixNano(ms: number): string {
  return `${ms}000000`;
}

export interface SpanHandle {
  spanId: string;
  end(attributes?: Record<string, string | number | boolean>): void;
}

/**
 * Collects spans for one logical operation (one chat turn-loop, one node
 * run) and exports them in a single OTLP/HTTP(JSON) POST at flush().
 */
export class TraceRecorder {
  private readonly spans: SpanRecord[] = [];

  constructor(
    private readonly rootTraceparent: string,
    rootName: string,
  ) {
    const parsed = parseTraceparent(rootTraceparent);
    if (!parsed) return;
    this.spans.push({
      name: rootName,
      spanId: parsed.spanId,
      traceId: parsed.traceId,
      startMs: Date.now(),
      attributes: {},
    });
  }

  startSpan(
    name: string,
    attributes: Record<string, string | number | boolean> = {},
  ): SpanHandle {
    const parent = currentTrace()?.traceparent ?? this.rootTraceparent;
    const parsed = parseTraceparent(parent);
    const spanId = newSpanId();
    const record: SpanRecord = {
      name,
      spanId,
      parentSpanId: parsed?.spanId,
      traceId: parsed?.traceId ?? newTraceId(),
      startMs: Date.now(),
      attributes,
    };
    this.spans.push(record);
    return {
      spanId,
      end: (extra) => {
        record.endMs = Date.now();
        Object.assign(record.attributes, extra ?? {});
      },
    };
  }

  /** Close the root span opened in the constructor — call before flush(). */
  endRoot(attributes?: Record<string, string | number | boolean>): void {
    const root = this.spans[0];
    if (!root || root.endMs !== undefined) return;
    root.endMs = Date.now();
    Object.assign(root.attributes, attributes ?? {});
  }

  /** Export all collected spans as one OTLP/JSON batch. No-op when
   * Langfuse is not configured or nothing was recorded. */
  async flush(): Promise<void> {
    const endpoint = langfuseOtlpEndpoint();
    const ready = this.spans.filter((s) => s.endMs !== undefined);
    if (!endpoint || ready.length === 0) return;

    const body = {
      resourceSpans: [
        {
          resource: {
            attributes: toOtelAttributes({ "service.name": "vimax-api" }),
          },
          scopeSpans: [
            {
              scope: { name: "vimax-trace" },
              spans: ready.map((s) => ({
                traceId: s.traceId,
                spanId: s.spanId,
                ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
                name: s.name,
                kind: 1,
                startTimeUnixNano: toUnixNano(s.startMs),
                endTimeUnixNano: toUnixNano(s.endMs!),
                attributes: toOtelAttributes(s.attributes),
                status: {},
              })),
            },
          ],
        },
      ],
    };

    try {
      await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: endpoint.authorization,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.warn("[trace] OTLP export failed:", err instanceof Error ? err.message : err);
    }
  }
}

function langfuseOtlpEndpoint(): { url: string; authorization: string } | null {
  const host = config.observability.langfuseHost();
  const publicKey = config.observability.langfusePublicKey();
  const secretKey = config.observability.langfuseSecretKey();
  if (!host || !publicKey || !secretKey) return null;
  return {
    url: `${host.replace(/\/+$/, "")}/api/public/otel/v1/traces`,
    authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
  };
}
