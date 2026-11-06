import { config } from "../../config/env.js";

export function extractTraceId(traceparent: string | null | undefined): string | null {
  if (!traceparent) return null;
  const parts = traceparent.trim().split("-");
  if (parts.length !== 4) return null;
  const traceId = parts[1] ?? "";
  return /^[0-9a-f]{32}$/.test(traceId) ? traceId : null;
}

export function langfuseScoreEndpoint(): { url: string; authorization: string } | null {
  const host = config.observability.langfuseHost();
  const publicKey = config.observability.langfusePublicKey();
  const secretKey = config.observability.langfuseSecretKey();
  if (!host || !publicKey || !secretKey) return null;
  return {
    url: `${host.replace(/\/+$/, "")}/api/public/scores`,
    authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString("base64")}`,
  };
}

export async function postFeedbackScore(traceparent: string, value: number, comment: string): Promise<void> {
  const endpoint = langfuseScoreEndpoint();
  if (!endpoint) return;
  const traceId = extractTraceId(traceparent);
  if (!traceId) return;
  await fetch(endpoint.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: endpoint.authorization,
    },
    body: JSON.stringify({ traceId, name: "user_feedback", value, comment }),
  });
}

export function postFeedbackScoreSafe(traceparent: string | undefined, value: number, comment: string): void {
  if (!traceparent) return;
  void postFeedbackScore(traceparent, value, comment).catch((err) => {
    console.warn("[langfuse] feedback score failed:", err instanceof Error ? err.message : err);
  });
}
