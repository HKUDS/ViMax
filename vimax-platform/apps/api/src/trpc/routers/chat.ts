import { TRPCError } from "@trpc/server";
import {
  CreateConversationInputSchema,
  ListConversationsInputSchema,
  GetMessagesInputSchema,
  DeleteConversationInputSchema,
} from "@vimax/contracts";
import { asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import {
  agentConversations,
  agentMessages,
  canvases,
} from "../../infrastructure/db/schema.js";
import {
  paginateConversations,
  paginateMessages,
} from "./chat-pagination.js";
import { protectedProcedure, router } from "../trpc.js";

// ── Helper: map internal errors to tRPC errors ──────────────────────

function mapError(err: unknown): never {
  const message = err instanceof Error ? err.message : "internal";
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message,
  });
}

// ── Chat Router ─────────────────────────────────────────────────────

export const chatRouter = router({
  /**
   * Create a new conversation for a canvas.
   */
  createConversation: protectedProcedure
    .input(CreateConversationInputSchema)
    .mutation(async ({ input }) => {
      try {
        const db = getDb();

        // Verify canvas exists
        const canvasRows = await db
          .select({ id: canvases.id })
          .from(canvases)
          .where(eq(canvases.id, input.canvasId))
          .limit(1);

        if (canvasRows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Canvas not found",
          });
        }

        const [conversation] = await db
          .insert(agentConversations)
          .values({
            canvasId: input.canvasId,
            title: input.title ?? null,
          })
          .returning();

        return {
          conversation: {
            id: conversation.id,
            canvasId: conversation.canvasId,
            title: conversation.title,
            createdAt: conversation.createdAt.toISOString(),
            updatedAt: conversation.updatedAt.toISOString(),
          },
        };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        return mapError(err);
      }
    }),

  /**
   * List conversations for a canvas (cursor-based pagination).
   */
  listConversations: protectedProcedure
    .input(ListConversationsInputSchema)
    .query(async ({ input }) => {
      try {
        const db = getDb();
        const limit = input.limit ?? 50;

        const rows = await db
          .select()
          .from(agentConversations)
          .where(eq(agentConversations.canvasId, input.canvasId))
          .orderBy(desc(agentConversations.updatedAt), desc(agentConversations.id));
        const page = paginateConversations(rows, {
          cursor: input.cursor,
          limit,
        });

        return {
          items: page.items.map((r) => ({
            id: r.id,
            canvasId: r.canvasId,
            title: r.title,
            createdAt: r.createdAt.toISOString(),
            updatedAt: r.updatedAt.toISOString(),
          })),
          nextCursor: page.nextCursor,
        };
      } catch (err) {
        return mapError(err);
      }
    }),

  /**
   * Get messages for a conversation (cursor-based pagination by message ID).
   */
  getMessages: protectedProcedure
    .input(GetMessagesInputSchema)
    .query(async ({ input }) => {
      try {
        const db = getDb();
        const limit = input.limit ?? 50;

        const rows = await db
          .select()
          .from(agentMessages)
          .where(eq(agentMessages.conversationId, input.conversationId))
          .orderBy(asc(agentMessages.id));
        const page = paginateMessages(rows, {
          cursor: input.cursor,
          limit,
        });

        return {
          items: page.items.map((r) => ({
            id: r.id,
            conversationId: r.conversationId,
            role: r.role,
            content: r.content,
            metadata: (r.metadata as Record<string, unknown>) ?? {},
            status: r.status,
            createdAt: r.createdAt.toISOString(),
          })),
          nextCursor: page.nextCursor,
        };
      } catch (err) {
        return mapError(err);
      }
    }),

  /**
   * Delete a conversation and all its messages.
   */
  deleteConversation: protectedProcedure
    .input(DeleteConversationInputSchema)
    .mutation(async ({ input }) => {
      try {
        const db = getDb();

        const result = await db
          .delete(agentConversations)
          .where(eq(agentConversations.id, input.conversationId))
          .returning({ id: agentConversations.id });

        if (result.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Conversation not found",
          });
        }

        return { ok: true };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        return mapError(err);
      }
    }),
});
