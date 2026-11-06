import { desc, eq } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import { feedbackEvents, jobs } from "../../infrastructure/db/schema.js";
import { postFeedbackScoreSafe } from "../../infrastructure/observability/langfuse-score.js";

export const FEEDBACK_SIGNALS = ["pick", "download", "retry", "discard", "thumb_up", "thumb_down"] as const;

export type FeedbackSignal = (typeof FEEDBACK_SIGNALS)[number];

const SIGNAL_SCORES: Record<FeedbackSignal, number> = {
  pick: 1,
  download: 1,
  thumb_up: 1,
  retry: 0.5,
  discard: 0,
  thumb_down: 0,
};

export function signalToScore(signal: FeedbackSignal): number {
  return SIGNAL_SCORES[signal];
}

export function normalizeFeedbackSignal(signal: string): FeedbackSignal | null {
  return (FEEDBACK_SIGNALS as readonly string[]).includes(signal) ? (signal as FeedbackSignal) : null;
}

export interface FeedbackInput {
  canvasId?: string;
  nodeId?: string;
  jobId?: string;
  assetId?: string;
  userId?: string;
  signal: string;
  metadata?: Record<string, unknown>;
}

export async function recordFeedback(input: FeedbackInput): Promise<{ recorded: boolean }> {
  const signal = normalizeFeedbackSignal(input.signal);
  if (!signal) return { recorded: false };

  const db = getDb();
  await db.insert(feedbackEvents).values({
    canvasId: input.canvasId ?? null,
    nodeId: input.nodeId ?? null,
    jobId: input.jobId ?? null,
    assetId: input.assetId ?? null,
    userId: input.userId ?? null,
    signal,
    metadata: input.metadata ?? {},
  });

  if (input.jobId) {
    const [job] = await db
      .select({ inputSnapshot: jobs.inputSnapshot })
      .from(jobs)
      .where(eq(jobs.id, input.jobId))
      .limit(1);
    const traceparent = (
      (job?.inputSnapshot as Record<string, unknown> | undefined)?._trace as
        | { traceparent?: string }
        | undefined
    )?.traceparent;
    if (traceparent) {
      postFeedbackScoreSafe(traceparent, signalToScore(signal), signal);
    }
  }

  return { recorded: true };
}

export interface TrainingPair {
  prompt: string;
  params: Record<string, unknown>;
  assetId: string | null;
  signal: string;
  createdAt: Date;
}

export async function exportTrainingPairs(limit = 200): Promise<TrainingPair[]> {
  const db = getDb();
  const rows = await db
    .select({
      signal: feedbackEvents.signal,
      assetId: feedbackEvents.assetId,
      createdAt: feedbackEvents.createdAt,
      inputSnapshot: jobs.inputSnapshot,
    })
    .from(feedbackEvents)
    .innerJoin(jobs, eq(feedbackEvents.jobId, jobs.id))
    .orderBy(desc(feedbackEvents.createdAt))
    .limit(limit);

  return rows.map((row) => {
    const snapshot = (row.inputSnapshot ?? {}) as Record<string, unknown>;
    const params: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(snapshot)) {
      if (!key.startsWith("_")) params[key] = value;
    }
    return {
      prompt: params.prompt as string,
      params,
      assetId: row.assetId,
      signal: row.signal,
      createdAt: row.createdAt,
    };
  });
}
