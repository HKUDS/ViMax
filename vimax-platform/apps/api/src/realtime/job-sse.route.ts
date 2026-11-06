import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { getJobEvents } from "../domain/job/job-event.service.js";
import { subscribeJobEvents } from "./sse.js";

export async function jobSseHandler(c: Context) {
  const jobId = c.req.param("jobId");
  if (!jobId) {
    return c.json({ error: "jobId required" }, 400);
  }

  return streamSSE(c, async (stream) => {
    const history = await getJobEvents(jobId);
    for (const event of history) {
      await stream.writeSSE({
        event: event.eventType,
        data: JSON.stringify({ job_id: jobId, ...(event.payload as object) }),
      });
    }

    let closed = false;

    const unsubscribe = subscribeJobEvents(jobId, async (event) => {
      if (closed) {
        return;
      }
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });
      if (event.type === "completed" || event.type === "failed") {
        closed = true;
        unsubscribe();
      }
    });

    await new Promise<void>((resolve) => {
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        resolve();
      });

      const interval = setInterval(() => {
        if (closed) {
          clearInterval(interval);
          resolve();
        }
      }, 300);
    });
  });
}
