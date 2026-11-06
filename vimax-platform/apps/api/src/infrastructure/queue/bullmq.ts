/**
 * BullMQ Queue + bridge Workers for generation jobs.
 *
 * Architecture:
 *   TS API enqueues → BullMQ Queue → Bridge Worker picks up
 *   → LPUSH to Redis list (Python worker BRPOPs)
 *   → Python publishes events → TS PubSub consumer
 *   → On completed: BullMQ job resolved
 *   → On failed:    BullMQ triggers retry (exponential backoff, N attempts)
 *
 * All five physical queues share one generic queue/worker factory driven
 * by `QUEUE_OPTIONS`, so concat/audio/pipeline get the same retry + DLQ
 * guarantees as image/video (previously they bypassed BullMQ entirely).
 */
import { Queue, Worker, type Job } from "bullmq";
import { config } from "../../config/env.js";
import { getRedisQueue } from "../redis/client.js";
import {
  QUEUE_OPTIONS,
  asQueueName,
  redisListKeyFor,
  type QueueName,
} from "./queue-config.js";

// ── Queues ─────────────────────────────────────────────────────────

const _queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  const queueName = asQueueName(name);
  let q = _queues.get(queueName);
  if (!q) {
    q = new Queue(queueName, {
      connection: { url: config.redisUrl() },
      defaultJobOptions: {
        attempts: QUEUE_OPTIONS[queueName].attempts,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: { age: 3600 * 24 },
        removeOnFail: { age: 3600 * 24 * 7 },
      },
    });
    _queues.set(queueName, q);
  }
  return q;
}

// Backward-compatible aliases.
export const getImageQueue = (): Queue => getQueue("q.image.std");
export const getVideoQueue = (): Queue => getQueue("q.video.std");

// ── Bridge workers ─────────────────────────────────────────────────

const _workers = new Map<QueueName, Worker>();

/**
 * Start (or return the existing) bridge worker for a queue. The worker
 * validates the payload, then LPUSHes it onto the Redis list the Python
 * worker consumes. A failed forward triggers BullMQ retry/backoff.
 */
export function startBridgeWorker(name: string): Worker {
  const queueName = asQueueName(name) as QueueName;
  let worker = _workers.get(queueName);
  if (worker) return worker;

  const opts = QUEUE_OPTIONS[queueName];
  const listKey = redisListKeyFor(queueName);

  worker = new Worker(
    queueName,
    async (job: Job) => {
      const parsed = opts.schema.safeParse(job.data);
      if (!parsed.success) {
        throw new Error(`Invalid ${queueName} payload: ${parsed.error.message}`);
      }
      const redis = getRedisQueue();
      await redis.lpush(listKey, JSON.stringify(job.data));
    },
    {
      connection: { url: config.redisUrl() },
      concurrency: opts.concurrency,
    },
  );

  worker.on("failed", (job, err) =>
    console.error(`[bridge ${queueName}] Job ${job?.id} failed:`, err.message),
  );
  worker.on("completed", (job) =>
    console.log(`[bridge ${queueName}] Job ${job.id} forwarded`),
  );

  _workers.set(queueName, worker);
  return worker;
}

/** Start bridge workers for every physical queue. */
export async function startAllBridgeWorkers(): Promise<void> {
  const workers = (Object.keys(QUEUE_OPTIONS) as QueueName[]).map(startBridgeWorker);
  await Promise.all(workers.map((worker) => worker.waitUntilReady()));
}

// ── Teardown ───────────────────────────────────────────────────────

export async function closeQueue(): Promise<void> {
  await Promise.allSettled([
    ...[..._queues.values()].map((q) => q.close()),
    ...[..._workers.values()].map((w) => w.close()),
  ]);
  _queues.clear();
  _workers.clear();
}

// Re-export for backward compat
export { getQueue as getQueueByName };
