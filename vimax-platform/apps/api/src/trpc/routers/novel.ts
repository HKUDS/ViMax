import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../../infrastructure/db/client.js";
import { novelImports } from "../../infrastructure/db/schema.js";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc.js";

// ── Novel chapter structure ────────────────────────────────────────

const ChapterSchema = z.object({
  index: z.number(),
  title: z.string(),
  content: z.string(),
  events: z.array(z.string()).optional(),
});

// ── Novel Import Router ────────────────────────────────────────────

export const novelRouter = router({
  /**
   * Import a novel — parse text into chapters.
   */
  importNovel: protectedProcedure
    .input(
      z.object({
        canvasId: z.string().uuid(),
        title: z.string().min(1).max(500),
        text: z.string().min(10),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();

      // Simple chapter parsing: split by common chapter markers
      const chapters = parseChapters(input.text);

      const [row] = await db
        .insert(novelImports)
        .values({
          canvasId: input.canvasId,
          title: input.title,
          originalText: input.text,
          chapters,
          status: "uploaded",
        })
        .returning();

      return {
        id: row!.id,
        title: row!.title,
        chapterCount: chapters.length,
        status: row!.status,
      };
    }),

  /**
   * Get novel import details.
   */
  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(novelImports)
        .where(eq(novelImports.id, input.id))
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Novel import not found" });
      }

      const n = rows[0]!;
      return {
        id: n.id,
        canvasId: n.canvasId,
        title: n.title,
        chapters: n.chapters,
        status: n.status,
        createdAt: n.createdAt.toISOString(),
      };
    }),

  /**
   * List novel imports for a canvas.
   */
  list: protectedProcedure
    .input(z.object({ canvasId: z.string().uuid() }))
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          id: novelImports.id,
          title: novelImports.title,
          status: novelImports.status,
          createdAt: novelImports.createdAt,
        })
        .from(novelImports)
        .where(eq(novelImports.canvasId, input.canvasId));

      return {
        items: rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }),

  /**
   * Extract events from a specific chapter.
   * Returns structured events that can be used for script generation.
   */
  extractEvents: protectedProcedure
    .input(
      z.object({
        novelImportId: z.string().uuid(),
        chapterIndex: z.number().int().min(0),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(novelImports)
        .where(eq(novelImports.id, input.novelImportId))
        .limit(1);

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Novel import not found" });
      }

      const chapters = rows[0]!.chapters as Array<{
        index: number;
        title: string;
        content: string;
        events?: string[];
      }>;
      const chapter = chapters[input.chapterIndex];

      if (!chapter) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Chapter ${input.chapterIndex} not found`,
        });
      }

      // Simple event extraction: split by sentence-ending punctuation
      // In production, this would use an LLM
      const sentences = chapter.content
        .split(/[。！？.!?\n]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 10);

      const events = sentences.slice(0, 20); // Max 20 events

      // Update chapter events
      chapter.events = events;
      await db
        .update(novelImports)
        .set({
          chapters,
          status: "events_extracted",
        })
        .where(eq(novelImports.id, input.novelImportId));

      return { chapterTitle: chapter.title, eventCount: events.length, events };
    }),

  /**
   * Delete a novel import.
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db.delete(novelImports).where(eq(novelImports.id, input.id));
      return { ok: true };
    }),
});

// ── Chapter Parser ─────────────────────────────────────────────────

function parseChapters(
  text: string,
): Array<{ index: number; title: string; content: string }> {
  // Common Chinese chapter markers
  const chapterPatterns = [
    /第[一二三四五六七八九十百千万零〇\d]+[章节回幕卷集部篇]/g,
    /Chapter\s+\d+/gi,
    /CHAPTER\s+\d+/g,
    /#{1,3}\s+.+/g, // Markdown headings
  ];

  // Try each pattern
  for (const pattern of chapterPatterns) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length >= 2) {
      const chapters: Array<{ index: number; title: string; content: string }> = [];
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i]!.index! + matches[i]![0].length;
        const end = i + 1 < matches.length ? matches[i + 1]!.index! : text.length;
        const title = matches[i]![0].replace(/^#+\s*/, "").trim();
        const content = text.slice(start, end).trim();
        if (content.length > 0) {
          chapters.push({ index: i, title, content });
        }
      }
      if (chapters.length > 0) return chapters;
    }
  }

  // Fallback: split by length
  const chunkSize = Math.max(1000, Math.floor(text.length / 5));
  const chapters: Array<{ index: number; title: string; content: string }> = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chapters.push({
      index: chapters.length,
      title: `片段 ${chapters.length + 1}`,
      content: text.slice(i, i + chunkSize),
    });
  }
  return chapters;
}
