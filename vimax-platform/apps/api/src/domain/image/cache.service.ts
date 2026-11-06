import { createHash } from "node:crypto";
import type { ImageGenerateInput } from "@vimax/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import { assets, jobs } from "../../infrastructure/db/schema.js";
import type { Asset } from "../../infrastructure/db/schema.js";

/** Deterministic JSON-ish serialization: sorted object keys so identical
 * content always produces the same string (and thus the same hash). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${k}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function buildImageCacheKey(input: {
  mode: string;
  prompt: string;
  model_id: string;
  size: string;
  reference_sha256s: string[];
  /** seed_lock — same content with a different seed must not collapse. */
  seed?: number;
  edit_op?: string;
  /** 操作对象（edit/text/compliance）与遮罩的内容指纹。 */
  source_sha256?: string;
  mask_sha256?: string;
  text_layers?: unknown;
  compliance_platforms?: string[];
}): string {
  const canonical = {
    mode: input.mode,
    prompt: input.prompt.trim(),
    model_id: input.model_id,
    size: input.size,
    refs: [...input.reference_sha256s].sort(),
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    ...(input.edit_op ? { edit_op: input.edit_op } : {}),
    ...(input.source_sha256 ? { source: input.source_sha256 } : {}),
    ...(input.mask_sha256 ? { mask: input.mask_sha256 } : {}),
    ...(input.text_layers ? { text_layers: input.text_layers } : {}),
    ...(input.compliance_platforms ? { platforms: input.compliance_platforms } : {}),
  };
  return createHash("sha256").update(stableStringify(canonical)).digest("hex");
}

/**
 * Find the most recent succeeded job for a cache key. Generic across job
 * types — image, video and concat executors all share it to short-circuit
 * identical re-runs.
 */
export async function findCachedJob(cacheKey: string) {
  const db = getDb();
  const [hit] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.cacheKey, cacheKey), eq(jobs.status, "succeeded")))
    .orderBy(desc(jobs.finishedAt))
    .limit(1);
  return hit ?? null;
}

export async function collectReferenceSha256s(assetIds: string[] | undefined): Promise<{
  assets: Asset[];
  sha256s: string[];
}> {
  if (!assetIds?.length) {
    return { assets: [], sha256s: [] };
  }

  const db = getDb();
  const rows = await db.select().from(assets).where(inArray(assets.id, assetIds));

  if (rows.length !== assetIds.length) {
    throw new Error("input.asset_not_found");
  }

  return {
    assets: rows,
    sha256s: rows.map((row: Asset) => row.sha256).sort(),
  };
}
