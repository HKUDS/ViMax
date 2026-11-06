// ── Node variation helpers (pure) ──────────────────────────────────
//
// "Variants" = N independent generations of the same image node params,
// collected into a gallery the user picks from. Diversity comes from the
// model's non-determinism; each job uses a distinct cache key so the
// dedup layer never collapses them into one.

export interface VariantEntry {
  assetId: string;
  jobId: string;
  /** Order in which the variant was requested (0-based). */
  index: number;
}

/** Maximum variants kept on a node (older ones drop off). */
export const MAX_VARIANTS = 12;

/**
 * Append a variant entry, capping the gallery at `max` (default
 * `MAX_VARIANTS`) by dropping the oldest. Returns a new array.
 */
export function appendVariant(
  variants: VariantEntry[] | undefined,
  entry: VariantEntry,
  max: number = MAX_VARIANTS,
): VariantEntry[] {
  const next = [...(variants ?? []), entry];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Predicate: does this job input snapshot carry the variant marker? */
export function isVariantJob(
  inputSnapshot: Record<string, unknown> | undefined,
): boolean {
  const marker = inputSnapshot?._variant as { index?: number } | undefined;
  return marker !== undefined && typeof marker.index === "number";
}
