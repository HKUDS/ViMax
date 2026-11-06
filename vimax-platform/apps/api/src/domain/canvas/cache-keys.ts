// ── Content-based cache keys for canvas jobs ───────────────────────
//
// Identical inputs must produce identical keys so a re-run with the same
// params is served from cache instead of re-billing a generation. The
// frame/clip assets are identified by their sha256 (content), not their
// asset id, so re-uploading the same image still hits.

import { createHash } from "node:crypto";
import { stableStringify } from "../image/cache.service.js";

export interface VideoCacheInput {
  model_id: string;
  prompt: string;
  first_frame_sha256: string | null;
  last_frame_sha256: string | null;
  duration_sec: number;
  resolution: string;
  aspect_ratio?: string;
  fps?: number;
}

export function buildVideoCacheKey(input: VideoCacheInput): string {
  const canonical = {
    kind: "video",
    model_id: input.model_id,
    prompt: input.prompt.trim(),
    ff: input.first_frame_sha256,
    lf: input.last_frame_sha256,
    dur: input.duration_sec,
    res: input.resolution,
    ar: input.aspect_ratio ?? "16:9",
    fps: input.fps ?? 16,
  };
  return createHash("sha256").update(stableStringify(canonical)).digest("hex");
}

export interface ConcatCacheInput {
  /** sha256 of each clip, in order. */
  clip_sha256s: string[];
  transition: string;
  /** Per-clip subtitle text — a subtitled concat is a different output. */
  subtitles?: Array<string | null>;
}

export function buildConcatCacheKey(input: ConcatCacheInput): string {
  const canonical = {
    kind: "concat",
    clips: input.clip_sha256s,
    transition: input.transition,
    subs: input.subtitles ?? null,
  };
  return createHash("sha256").update(stableStringify(canonical)).digest("hex");
}
