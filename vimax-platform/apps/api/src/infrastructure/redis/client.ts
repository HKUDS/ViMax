import { Redis } from "ioredis";
import { config } from "../../config/env.js";

let publisher: Redis | null = null;
let subscriber: Redis | null = null;
let queueClient: Redis | null = null;

function createClient(): Redis {
  return new Redis(config.redisUrl(), {
    maxRetriesPerRequest: null,
  });
}

export function getRedisPublisher(): Redis {
  if (!publisher) {
    publisher = createClient();
  }
  return publisher;
}

export function getRedisSubscriber(): Redis {
  if (!subscriber) {
    subscriber = createClient();
  }
  return subscriber;
}

export function getRedisQueue(): Redis {
  if (!queueClient) {
    queueClient = createClient();
  }
  return queueClient;
}

export async function closeRedis(): Promise<void> {
  await Promise.all([
    publisher?.quit(),
    subscriber?.quit(),
    queueClient?.quit(),
  ]);
  publisher = null;
  subscriber = null;
  queueClient = null;
}

export const QUEUE_KEY = "vimax:queue:q.image.std";

export function jobEventChannel(jobId: string): string {
  return `events:job:${jobId}`;
}
