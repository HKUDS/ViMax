import type {
  AudioJobPayloadValidated,
  ConcatJobPayloadValidated,
  ImageJobPayload,
  PipelineJobPayloadValidated,
  VideoJobPayload,
} from "@vimax/contracts";
import { getQueue } from "./bullmq.js";

/**
 * Enqueue a job onto its BullMQ queue. The bridge worker forwards it to
 * the matching Redis list for the Python worker. `payload.job_id` becomes
 * the BullMQ job id, so retries reuse the same id (idempotent on queue).
 */
async function enqueue(
  queueName: string,
  payload: { job_id: string; job_type: string },
): Promise<void> {
  await getQueue(queueName).add(payload.job_type, payload, {
    jobId: payload.job_id,
  });
}

export function enqueueImageJob(payload: ImageJobPayload): Promise<void> {
  return enqueue("q.image.std", payload);
}

export function enqueueVideoJob(payload: VideoJobPayload): Promise<void> {
  return enqueue("q.video.std", payload);
}

export function enqueueConcatJob(payload: ConcatJobPayloadValidated): Promise<void> {
  return enqueue("q.concat.std", payload);
}

export function enqueueAudioJob(payload: AudioJobPayloadValidated): Promise<void> {
  return enqueue("q.audio.std", payload);
}

export function enqueuePipelineJob(payload: PipelineJobPayloadValidated): Promise<void> {
  return enqueue("q.pipeline.full", payload);
}
