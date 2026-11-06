import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import { canvasNodes, characters } from "../../infrastructure/db/schema.js";

// ── Create character ───────────────────────────────────────────────

export async function createCharacter(input: {
  name: string;
  description?: string;
  frontAssetId?: string;
  sideAssetId?: string;
  backAssetId?: string;
  tags?: string[];
}, tenantId = "default") {
  const db = getDb();
  const [created] = await db
    .insert(characters)
    .values({
      tenantId,
      name: input.name,
      description: input.description ?? null,
      frontAssetId: input.frontAssetId ?? null,
      sideAssetId: input.sideAssetId ?? null,
      backAssetId: input.backAssetId ?? null,
      tags: input.tags ?? [],
    })
    .returning();
  return created;
}

// ── List characters ────────────────────────────────────────────────

export async function listCharacters(tenantId = "default", limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(characters)
    .where(eq(characters.tenantId, tenantId))
    .orderBy(desc(characters.updatedAt))
    .limit(limit);
}

// ── Update character ───────────────────────────────────────────────

export async function updateCharacter(
  characterId: string,
  updates: {
    name?: string;
    description?: string;
    frontAssetId?: string;
    sideAssetId?: string;
    backAssetId?: string;
    tags?: string[];
  },
) {
  const db = getDb();
  const [updated] = await db
    .update(characters)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(characters.id, characterId))
    .returning();
  return updated ?? null;
}

// ── Delete character ───────────────────────────────────────────────

export async function deleteCharacter(characterId: string) {
  const db = getDb();
  const [deleted] = await db
    .delete(characters)
    .where(eq(characters.id, characterId))
    .returning({ id: characters.id });
  return !!deleted;
}

// ── Link character to canvas node ─────────────────────────────────

export async function linkCharacterToNode(
  canvasId: string,
  nodeId: string,
  characterId: string,
) {
  const db = getDb();
  // Fetch character data
  const [character] = await db
    .select()
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  if (!character) throw new Error("character.not_found");

  // Update node data with character info
  const [node] = await db
    .select({ data: canvasNodes.data })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node) throw new Error("canvas.node_not_found");

  const currentData = (node.data as Record<string, unknown>) ?? {};
  await db
    .update(canvasNodes)
    .set({
      data: {
        ...currentData,
        name: character.name,
        description: character.description ?? "",
        frontAssetId: character.frontAssetId,
        sideAssetId: character.sideAssetId,
        backAssetId: character.backAssetId,
      },
      updatedAt: new Date(),
    })
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)));
}
