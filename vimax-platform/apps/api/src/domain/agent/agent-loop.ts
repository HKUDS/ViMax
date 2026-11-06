// ── Agent loop policy (pure) ─────────────────────────────────────────
//
// Termination budget and feedback-message shaping for the chat agent
// loop in realtime/websocket.ts. Free of I/O so the loop's guardrails
// (step cap, token budget, repeated-failure circuit breaker) stay
// unit-testable.

import type { AIMessage } from "./ai-service.js";

/** LLM turns per user message. Each turn may carry several tool calls. */
export const MAX_AGENT_STEPS = 8;

/** Total prompt+completion tokens across the whole loop, all steps. */
export const AGENT_TOKEN_BUDGET = 120_000;

/** Recent conversation messages replayed into the model context. */
export const HISTORY_WINDOW = 20;

/** A tool that fails twice with identical canonical args stops the loop —
 * a third identical attempt is a dead loop, not a transient error. */
export const REPEATED_FAILURE_LIMIT = 2;

/** Tool results larger than this are truncated before being fed back —
 * a multi-KB blob would burn the token budget without helping the model. */
const TOOL_RESULT_MAX_CHARS = 1_500;

/**
 * Order-independent canonical key for a tool call, so "same tool + same
 * args" is detected even when the model reorders JSON object keys.
 */
export function canonicalToolKey(name: string, args: Record<string, unknown>): string {
  const stable = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a.localeCompare(b),
      );
      return `{${entries.map(([k, v]) => `${k}:${stable(v)}`).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  };
  return `${name}(${stable(args)})`;
}

/** Increment the failure counter for a call key; true when the circuit
 * breaker should trip (the call just failed for the Nth identical time). */
export function isRepeatedFailure(counts: Map<string, number>, key: string): boolean {
  const count = (counts.get(key) ?? 0) + 1;
  counts.set(key, count);
  return count >= REPEATED_FAILURE_LIMIT;
}

/**
 * OpenAI-format tool result message fed back to the model after
 * executeToolCall. `result` is truncated — the model needs the outcome,
 * not the full payload.
 */
export function toolResultMessage(
  toolCallId: string,
  outcome: { success: boolean; message: string; result?: unknown },
): AIMessage {
  return {
    role: "tool",
    tool_call_id: toolCallId,
    content: JSON.stringify({
      success: outcome.success,
      message: outcome.message,
      ...(outcome.result !== undefined
        ? { result: truncateValue(outcome.result, TOOL_RESULT_MAX_CHARS) }
        : {}),
    }),
  };
}

function truncateValue(value: unknown, maxChars: number): unknown {
  let json: string;
  try {
    json = JSON.stringify(value) ?? "";
  } catch {
    return String(value).slice(0, maxChars);
  }
  if (json.length <= maxChars) return value;
  return `${json.slice(0, maxChars)}…(truncated)`;
}
