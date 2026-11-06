import { z } from "zod";
import { MESSAGE_ROLES, MESSAGE_STATUSES } from "./chat-types.js";

// ── Conversation Schemas ────────────────────────────────────────────

export const CreateConversationInputSchema = z.object({
  canvasId: z.string().uuid(),
  title: z.string().max(200).optional(),
});

export const CreateConversationOutputSchema = z.object({
  conversation: z.object({
    id: z.string().uuid(),
    canvasId: z.string().uuid(),
    title: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

export const ListConversationsInputSchema = z.object({
  canvasId: z.string().uuid(),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export const ListConversationsOutputSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      canvasId: z.string().uuid(),
      title: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});

// ── Message Schemas ─────────────────────────────────────────────────

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.unknown()),
  status: z.enum(["pending", "running", "completed", "failed"]),
  result: z.unknown().optional(),
});

export const MessageReferenceSchema = z.object({
  type: z.enum(["node", "asset", "job"]),
  id: z.string(),
  label: z.string().optional(),
});

export const MessageMetadataSchema = z.object({
  toolCalls: z.array(ToolCallSchema).optional(),
  thinking: z.string().optional(),
  references: z.array(MessageReferenceSchema).optional(),
  durationMs: z.number().optional(),
});

export const AgentMessageSchema = z.object({
  id: z.number(),
  conversationId: z.string().uuid(),
  role: z.enum(MESSAGE_ROLES),
  content: z.string(),
  metadata: MessageMetadataSchema,
  status: z.enum(MESSAGE_STATUSES),
  createdAt: z.string(),
});

export const GetMessagesInputSchema = z.object({
  conversationId: z.string().uuid(),
  cursor: z.number().optional(),
  limit: z.number().int().min(1).max(100).optional().default(50),
});

export const GetMessagesOutputSchema = z.object({
  items: z.array(AgentMessageSchema),
  nextCursor: z.number().nullable(),
});

export const DeleteConversationInputSchema = z.object({
  conversationId: z.string().uuid(),
});

export const DeleteConversationOutputSchema = z.object({
  ok: z.boolean(),
});

// ── Canvas Mutation Schemas (for validation of agent mutations) ─────

export const CanvasMutationNodeSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.unknown()),
});

export const CanvasMutationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("nodes.add"),
    nodes: z.array(CanvasMutationNodeSchema),
  }),
  z.object({
    type: z.literal("nodes.update"),
    updates: z.array(
      z.object({
        id: z.string().uuid(),
        data: z.record(z.unknown()),
      }),
    ),
  }),
  z.object({
    type: z.literal("nodes.remove"),
    ids: z.array(z.string().uuid()),
  }),
  z.object({
    type: z.literal("edges.add"),
    edges: z.array(
      z.object({
        id: z.string().uuid(),
        source: z.string().uuid(),
        target: z.string().uuid(),
        sourceHandle: z.string().optional(),
        targetHandle: z.string().optional(),
      }),
    ),
  }),
  z.object({
    type: z.literal("edges.remove"),
    ids: z.array(z.string().uuid()),
  }),
  z.object({
    type: z.literal("layout.arrange"),
    direction: z.enum(["LR", "TB", "zone"]),
  }),
]);
