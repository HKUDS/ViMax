// ── Queue configuration (pure) ─────────────────────────────────────
//
// The physical BullMQ queues the platform dispatches to, plus the Redis
// list each bridge worker LPUSHes to (the Python worker BRPOPs from that
// list). Free of BullMQ/Redis imports so it is unit-testable.
//
// Note: `q.image.refine` appears as a cosmetic DB label for some image
// jobs, but they are physically enqueued onto `q.image.std` (there is no
// separate consumer for `refine`), so it is intentionally NOT a queue here.

import type { z } from "zod";
import {
  AudioJobPayloadSchema,
  ConcatJobPayloadSchema,
  ImageJobPayloadSchema,
  PipelineJobPayloadSchema,
  VideoJobPayloadSchema,
} from "@vimax/contracts";

/** Redis list key prefix the Python workers BRPOP from. */
export const REDIS_QUEUE_PREFIX = "vimax:queue:";

/** Every physical queue name the platform dispatches to. */
export const QUEUE_NAMES = [
  "q.image.std",
  "q.video.std",
  "q.concat.std",
  "q.audio.std",
  "q.pipeline.full",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export interface QueueOptions {
  /** Bridge worker concurrency. */
  concurrency: number;
  /** BullMQ retry attempts for transient failures. */
  attempts: number;
  /** Payload schema used to validate before forwarding to the Python worker. */
  schema: z.ZodType;
}

/**
 * Per-queue execution profile. Drives BullMQ `defaultJobOptions`, the
 * bridge worker concurrency, and payload validation in one place.
 */
export const QUEUE_OPTIONS: Record<QueueName, QueueOptions> = {
  "q.image.std": { concurrency: 5, attempts: 3, schema: ImageJobPayloadSchema },
  "q.video.std": { concurrency: 2, attempts: 2, schema: VideoJobPayloadSchema },
  "q.concat.std": { concurrency: 2, attempts: 3, schema: ConcatJobPayloadSchema },
  "q.audio.std": { concurrency: 3, attempts: 3, schema: AudioJobPayloadSchema },
  "q.pipeline.full": { concurrency: 2, attempts: 2, schema: PipelineJobPayloadSchema },
};

/** BullMQ queue name → Redis list key the bridge worker LPUSHes to. */
export function redisListKeyFor(queueName: string): string {
  return `${REDIS_QUEUE_PREFIX}${queueName}`;
}

/** Assert a name is a known physical queue; returns it typed. */
export function asQueueName(name: string): QueueName {
  if (!Object.prototype.hasOwnProperty.call(QUEUE_OPTIONS, name)) {
    throw new Error(`Unknown queue: ${name}`);
  }
  return name as QueueName;
}
