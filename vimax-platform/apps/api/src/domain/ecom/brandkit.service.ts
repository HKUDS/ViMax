// ── Brand Kit Service ────────────────────────────────────────────────

import { desc, eq } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import { brandKits } from "../../infrastructure/db/schema.js";

/** Render a brand kit as the constraint fragment appended to image prompts.
 * Empty sections are skipped; an all-empty kit yields "". Pure. */
export function brandKitToConstraints(kit: {
  colors?: unknown;
  fonts?: unknown;
  slogan?: string | null;
  bannedWords?: unknown;
}): string {
  const parts: string[] = [];
  const colors = colorLabels(kit.colors);
  if (colors.length > 0) parts.push(`品牌色：${colors.join("、")}`);
  const fonts = stringList(kit.fonts);
  if (fonts.length > 0) parts.push(`字体：${fonts.join("、")}`);
  if (kit.slogan?.trim()) parts.push(`口号：${kit.slogan.trim()}`);
  const banned = stringList(kit.bannedWords);
  if (banned.length > 0) parts.push(`画面避免出现：${banned.join("、")}`);
  return parts.join("；");
}

function colorLabels(colors: unknown): string[] {
  if (!Array.isArray(colors)) return [];
  return colors
    .map((c) => {
      if (typeof c === "string") return c.trim() || null;
      if (c && typeof c === "object") {
        const hex = (c as Record<string, unknown>).hex;
        const usage = (c as Record<string, unknown>).usage;
        if (typeof hex !== "string" || !hex.trim()) return null;
        return typeof usage === "string" && usage.trim()
          ? `${hex.trim()}(${usage.trim()})`
          : hex.trim();
      }
      return null;
    })
    .filter((s): s is string => s !== null);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string" && v.trim() !== "")
    .map((v) => v.trim());
}

export async function saveBrandKit(input: {
  name: string;
  colors?: Array<{ hex: string; usage?: string }>;
  fonts?: string[];
  slogan?: string;
  bannedWords?: string[];
  guidelines?: string;
  logoAssetId?: string;
}): Promise<{ kitId: string }> {
  const db = getDb();
  const [kit] = await db
    .insert(brandKits)
    .values({
      name: input.name,
      colors: input.colors ?? [],
      fonts: input.fonts ?? [],
      slogan: input.slogan ?? null,
      bannedWords: input.bannedWords ?? [],
      guidelines: input.guidelines ?? null,
      logoAssetId: input.logoAssetId ?? null,
    })
    .returning({ id: brandKits.id });
  return { kitId: kit!.id };
}

export async function getBrandKit(kitId?: string) {
  const db = getDb();
  if (kitId) {
    const [kit] = await db.select().from(brandKits).where(eq(brandKits.id, kitId)).limit(1);
    return kit ?? null;
  }
  const [kit] = await db
    .select()
    .from(brandKits)
    .orderBy(desc(brandKits.createdAt))
    .limit(1);
  return kit ?? null;
}
