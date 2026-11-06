import type { JobEventValidated } from "@vimax/contracts";
import { getRedisSubscriber } from "../redis/client.js";
import { handleJobEvent } from "../../domain/job/job-event.service.js";

let started = false;

export async function startJobEventConsumer(): Promise<void> {
  if (started) {
    return;
  }
  started = true;

  const subscriber = getRedisSubscriber();
  await subscriber.psubscribe("events:job:*");

  subscriber.on("pmessage", async (_pattern: string, _channel: string, message: string) => {
    try {
      await handleJobEvent(message);
    } catch (err) {
      console.error("Failed to handle job event:", err);
    }
  });

  console.log("Job event consumer subscribed to events:job:*");
}
