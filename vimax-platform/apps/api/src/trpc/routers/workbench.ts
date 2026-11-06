import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../../infrastructure/db/client.js";
import { workbenches } from "../../infrastructure/db/schema.js";
import { eq } from "drizzle-orm";
import { createDefaultTracks } from "@vimax/contracts";
import { protectedProcedure, router } from "../trpc.js";

// Inline fallback if not exported yet
function getDefaultTracks(): Record<string, unknown>[] {
  try {
    return createDefaultTracks() as unknown as Record<string, unknown>[];
  } catch {
    return [];
  }
}

export const workbenchRouter = router({
  /**
   * Create a new workbench.
   */
  create: protectedProcedure
    .input(z.object({
      canvasId: z.string().uuid().optional(),
      name: z.string().min(1).max(200),
      resolution: z.enum(["1920x1080", "1080x1080", "1080x1920"]).optional(),
      fps: z.number().int().min(1).max(60).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const defaultTracks = getDefaultTracks();

      const [row] = await db
        .insert(workbenches)
        .values({
          canvasId: input.canvasId ?? null,
          name: input.name,
          resolution: input.resolution ?? "1920x1080",
          fps: input.fps ?? 24,
          tracks: defaultTracks,
        })
        .returning();

      return {
        id: row!.id,
        name: row!.name,
        resolution: row!.resolution,
        fps: row!.fps,
        tracks: row!.tracks,
        createdAt: row!.createdAt.toISOString(),
      };
    }),

  /**
   * Get a workbench by ID.
   */
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(workbenches)
        .where(eq(workbenches.id, input.id))
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workbench not found" });
      }

      const w = rows[0]!;
      return {
        id: w.id,
        canvasId: w.canvasId,
        name: w.name,
        durationMs: w.durationMs,
        resolution: w.resolution,
        fps: w.fps,
        tracks: w.tracks,
        coverUrl: w.coverUrl,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
      };
    }),

  /**
   * List workbenches for a canvas.
   */
  list: protectedProcedure
    .input(z.object({ canvasId: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(workbenches)
        .where(eq(workbenches.canvasId, input.canvasId));

      return {
        items: rows.map((w) => ({
          id: w.id,
          name: w.name,
          durationMs: w.durationMs,
          resolution: w.resolution,
          trackCount: (w.tracks as unknown[])?.length ?? 0,
          updatedAt: w.updatedAt.toISOString(),
        })),
      };
    }),

  /**
   * Update tracks in a workbench.
   */
  updateTracks: protectedProcedure
    .input(z.object({
      workbenchId: z.string().uuid(),
      tracks: z.array(z.record(z.unknown())),
    }))
    .mutation(async ({ input }) => {
      const db = getDb();
      const result = await db
        .update(workbenches)
        .set({ tracks: input.tracks })
        .where(eq(workbenches.id, input.workbenchId))
        .returning({ id: workbenches.id });

      if (result.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Workbench not found" });
      }

      return { ok: true };
    }),

  /**
   * Delete a workbench.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(workbenches).where(eq(workbenches.id, input.id));
      return { ok: true };
    }),
});
