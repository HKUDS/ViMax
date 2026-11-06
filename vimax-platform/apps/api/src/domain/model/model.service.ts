// ── Model Service ─────────────────────────────────────────────────────
// DB-backed model configuration CRUD. Replaces hardcoded model arrays
// from @vimax/contracts with a tenant-scoped, user-editable table.

import { eq, and, sql } from "drizzle-orm";
import { getDb, schema } from "../../infrastructure/db/client.js";
import { IMAGE_MODELS, VIDEO_MODELS, DEFAULT_TEXT_MODEL, DEFAULT_TTS_MODEL } from "@vimax/contracts";
import type { ModelDescriptor, ModelType } from "@vimax/contracts";
import type { ModelRow } from "../../infrastructure/db/schema.js";

// ── Drizzle enum type helper ──────────────────────────────────────────

type ModelTypeEnum = typeof schema.models.$inferSelect["type"];

// ── Helpers ──────────────────────────────────────────────────────────

function rowToDescriptor(row: ModelRow): ModelDescriptor {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    type: row.type as ModelType,
    provider: row.provider,
    vendorId: row.vendorId ?? null,
    vendorModelId: row.vendorModelId ?? null,
    classPath: row.classPath ?? null,
    baseUrl: row.baseUrl ?? null,
    // Credentials are used server-side and must never be returned by model APIs.
    apiKey: null,
    config: (row.config as Record<string, unknown>) ?? {},
    isDefault: row.isDefault === 1,
    isEnabled: row.isEnabled === 1,
    priority: row.priority ?? 0,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: row.updatedAt?.toISOString() ?? new Date().toISOString(),
  };
}

// ── Hardcoded fallback (used when DB is empty or missing a type) ─────

const HARDCODED_IMAGE_DEFAULTS: ModelDescriptor[] = IMAGE_MODELS.map((m, i) => ({
  id: `_fallback_image_${i}`,
  tenantId: "default",
  name: m.label,
  type: "image" as ModelType,
  provider: m.provider,
  vendorId: null,
  vendorModelId: null,
  classPath: m.class_path,
  baseUrl: m.init_args?.base_url ?? null,
  apiKey: null,
  config: { sizes: m.sizes, supports_reference: m.supports_reference, init_args: m.init_args ?? {} },
  isDefault: i === 0,
  isEnabled: true,
  priority: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}));

const HARDCODED_VIDEO_DEFAULTS: ModelDescriptor[] = VIDEO_MODELS.map((m, i) => ({
  id: `_fallback_video_${i}`,
  tenantId: "default",
  name: m.label,
  type: "video" as ModelType,
  provider: m.provider,
  vendorId: null,
  vendorModelId: null,
  classPath: m.class_path,
  baseUrl: m.init_args?.base_url ?? null,
  apiKey: null,
  config: { maxDuration: m.maxDuration, resolutions: m.resolutions, init_args: m.init_args ?? {} },
  isDefault: i === 0,
  isEnabled: true,
  priority: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}));

const HARDCODED_TEXT_DEFAULTS: ModelDescriptor[] = [
  {
    id: "_fallback_text_0",
    tenantId: "default",
    name: DEFAULT_TEXT_MODEL.label,
    type: "text" as ModelType,
    provider: DEFAULT_TEXT_MODEL.provider,
    vendorId: DEFAULT_TEXT_MODEL.vendorId,
    vendorModelId: DEFAULT_TEXT_MODEL.vendorModelId,
    classPath: null,
    baseUrl: null,
    apiKey: null,
    config: { maxTokens: DEFAULT_TEXT_MODEL.maxTokens, supportsThinking: DEFAULT_TEXT_MODEL.supportsThinking },
    isDefault: true,
    isEnabled: true,
    priority: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const HARDCODED_TTS_DEFAULTS: ModelDescriptor[] = [
  {
    id: "_fallback_tts_0",
    tenantId: "default",
    name: DEFAULT_TTS_MODEL.label,
    type: "tts" as ModelType,
    provider: DEFAULT_TTS_MODEL.provider,
    vendorId: null,
    vendorModelId: DEFAULT_TTS_MODEL.vendorModelId,
    classPath: DEFAULT_TTS_MODEL.classPath,
    baseUrl: DEFAULT_TTS_MODEL.baseUrl,
    apiKey: null,
    config: { voice: DEFAULT_TTS_MODEL.voice },
    isDefault: true,
    isEnabled: true,
    priority: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const ALL_FALLBACKS: Record<string, ModelDescriptor[]> = {
  image: HARDCODED_IMAGE_DEFAULTS,
  video: HARDCODED_VIDEO_DEFAULTS,
  text: HARDCODED_TEXT_DEFAULTS,
  tts: HARDCODED_TTS_DEFAULTS,
};

// ── CRUD ──────────────────────────────────────────────────────────────

export async function getModels(tenantId: string, type?: string): Promise<ModelDescriptor[]> {
  const db = getDb();
  const conditions: ReturnType<typeof eq>[] = [
    eq(schema.models.tenantId, tenantId),
    eq(schema.models.isEnabled, 1),
  ];
  if (type) {
    conditions.push(eq(schema.models.type, type as ModelTypeEnum));
  }
  const rows = await db
    .select()
    .from(schema.models)
    .where(and(...conditions))
    .orderBy(schema.models.priority, schema.models.name);
  return rows.map(rowToDescriptor);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getModelById(id: string): Promise<ModelDescriptor | null> {
  // Preset ids (e.g. "doubao-seedance-1-0-lite") resolve through the
  // contracts presets, not the DB — a non-UUID here must be a clean miss,
  // not a Postgres uuid-cast error.
  if (!UUID_RE.test(id)) return null;
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.models)
    .where(eq(schema.models.id, id))
    .limit(1);
  if (rows.length === 0) return null;
  return rowToDescriptor(rows[0]!);
}

export async function createModel(
  tenantId: string,
  input: { name: string; type: string; provider: string; vendorId?: string; vendorModelId?: string; classPath?: string; baseUrl?: string; apiKey?: string; config?: Record<string, unknown>; isDefault?: boolean; isEnabled?: boolean; priority?: number },
): Promise<ModelDescriptor> {
  const db = getDb();

  const rows = await db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx.update(schema.models).set({ isDefault: 0 }).where(and(
        eq(schema.models.tenantId, tenantId),
        eq(schema.models.type, input.type as ModelTypeEnum),
        eq(schema.models.isDefault, 1),
      ));
    }
    return tx.insert(schema.models).values({
      name: input.name,
      type: input.type as ModelTypeEnum,
      provider: input.provider,
      vendorId: input.vendorId ?? null,
      vendorModelId: input.vendorModelId ?? null,
      classPath: input.classPath ?? null,
      baseUrl: input.baseUrl ?? null,
      apiKey: input.apiKey ?? null,
      config: input.config ?? {},
      isDefault: input.isDefault ? 1 : 0,
      isEnabled: input.isEnabled !== false ? 1 : 0,
      priority: input.priority ?? 0,
    }).returning();
  });
  return rowToDescriptor(rows[0]!);
}

export async function updateModel(
  id: string,
  input: Partial<{ name: string; type: string; provider: string; vendorId: string; vendorModelId: string; classPath: string; baseUrl: string; apiKey: string; config: Record<string, unknown>; isDefault: boolean; isEnabled: boolean; priority: number }>,
): Promise<ModelDescriptor | null> {
  const db = getDb();

  // Get existing model first
  const existing = await getModelById(id);
  if (!existing) return null;

  const updateData: Record<string, unknown> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.type !== undefined) updateData.type = input.type;
  if (input.provider !== undefined) updateData.provider = input.provider;
  if (input.vendorId !== undefined) updateData.vendorId = input.vendorId || null;
  if (input.vendorModelId !== undefined) updateData.vendorModelId = input.vendorModelId || null;
  if (input.classPath !== undefined) updateData.classPath = input.classPath || null;
  if (input.baseUrl !== undefined) updateData.baseUrl = input.baseUrl || null;
  if (input.apiKey !== undefined) updateData.apiKey = input.apiKey || null;
  if (input.config !== undefined) updateData.config = input.config;
  if (input.isDefault !== undefined) updateData.isDefault = input.isDefault ? 1 : 0;
  if (input.isEnabled !== undefined) updateData.isEnabled = input.isEnabled ? 1 : 0;
  if (input.priority !== undefined) updateData.priority = input.priority;

  const rows = await db.transaction(async (tx) => {
    if (input.isDefault) {
      const targetType = input.type ?? existing.type;
      await tx.update(schema.models).set({ isDefault: 0 }).where(and(
        eq(schema.models.tenantId, existing.tenantId),
        eq(schema.models.type, targetType as ModelTypeEnum),
        eq(schema.models.isDefault, 1),
        sql`${schema.models.id} != ${id}`,
      ));
    }
    return tx.update(schema.models).set(updateData).where(eq(schema.models.id, id)).returning();
  });
  if (rows.length === 0) return null;
  return rowToDescriptor(rows[0]!);
}

export async function deleteModel(id: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .delete(schema.models)
    .where(eq(schema.models.id, id));
  return true;
}

// ── Default Model Resolution ─────────────────────────────────────────

export async function getDefaultModel(
  tenantId: string,
  type: string,
): Promise<ModelDescriptor> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.models)
    .where(
      and(
        eq(schema.models.tenantId, tenantId),
        eq(schema.models.type, type as ModelTypeEnum),
        eq(schema.models.isDefault, 1),
        eq(schema.models.isEnabled, 1),
      ),
    )
    .limit(1);

  if (rows.length > 0) {
    return rowToDescriptor(rows[0]!);
  }

  // Fall back to hardcoded defaults
  const fallbacks = ALL_FALLBACKS[type];
  if (fallbacks?.length) {
    return fallbacks[0]!;
  }

  throw new Error(`No default model configured for type "${type}" and no fallback available`);
}

// ── Seed ──────────────────────────────────────────────────────────────

export async function seedModels(): Promise<number> {
  const db = getDb();
  try {
    const existing = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.models);
    const n = existing[0]?.count ?? 0;
    if (n > 0) {
      console.log(`[seed] models table already has ${n} rows, skipping`);
      return 0;
    }
  } catch {
    // Table might not exist yet, skip seed
    console.log("[seed] models table not found, skipping seed (run migration first)");
    return 0;
  }

  const toInsert = [
    ...HARDCODED_TEXT_DEFAULTS.map((m) => ({
      // tenantId uses default value
      name: m.name,
      type: m.type,
      provider: m.provider,
      vendorId: m.vendorId,
      vendorModelId: m.vendorModelId,
      classPath: m.classPath,
      baseUrl: m.baseUrl,
      config: m.config,
      isDefault: m.isDefault ? 1 : 0,
      isEnabled: m.isEnabled ? 1 : 0,
      priority: m.priority,
    })),
    ...HARDCODED_IMAGE_DEFAULTS.map((m) => ({
      // tenantId uses default value
      name: m.name,
      type: m.type,
      provider: m.provider,
      vendorId: m.vendorId,
      vendorModelId: m.vendorModelId,
      classPath: m.classPath,
      baseUrl: m.baseUrl,
      config: m.config,
      isDefault: m.isDefault ? 1 : 0,
      isEnabled: m.isEnabled ? 1 : 0,
      priority: m.priority,
    })),
    ...HARDCODED_VIDEO_DEFAULTS.map((m) => ({
      // tenantId uses default value
      name: m.name,
      type: m.type,
      provider: m.provider,
      vendorId: m.vendorId,
      vendorModelId: m.vendorModelId,
      classPath: m.classPath,
      baseUrl: m.baseUrl,
      config: m.config,
      isDefault: m.isDefault ? 1 : 0,
      isEnabled: m.isEnabled ? 1 : 0,
      priority: m.priority,
    })),
  ];

  let seeded = 0;
  for (const row of toInsert) {
    try {
      await db.insert(schema.models).values(row);
      seeded++;
    } catch (err) {
      console.warn(`[seed] Failed to insert model "${row.name}":`, err);
    }
  }

  console.log(`[seed] models: inserted ${seeded} default models`);
  return seeded;
}
