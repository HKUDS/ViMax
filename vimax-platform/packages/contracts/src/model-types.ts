import { z } from "zod";

// ── Model Type Enum ────────────────────────────────────────────────────

export const MODEL_TYPES = ["text", "image", "video", "tts", "embedding"] as const;
export type ModelType = (typeof MODEL_TYPES)[number];

// ── Model Descriptor ───────────────────────────────────────────────────

export interface ModelDescriptor {
  id: string;
  tenantId: string;
  name: string;
  type: ModelType;
  provider: string;
  vendorId: string | null;
  vendorModelId: string | null;
  classPath: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  config: Record<string, unknown>;
  isDefault: boolean;
  isEnabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
}

// ── Model List Item (subset sent to frontend) ──────────────────────────

export interface ModelListItem {
  id: string;
  name: string;
  type: ModelType;
  provider: string;
  vendorId: string | null;
  vendorModelId: string | null;
  isDefault: boolean;
  isEnabled: boolean;
  priority: number;
}

// ── Zod Schemas for tRPC Input Validation ──────────────────────────────

export const CreateModelInputSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(MODEL_TYPES),
  provider: z.string().min(1).max(100),
  vendorId: z.string().max(100).optional(),
  vendorModelId: z.string().max(200).optional(),
  classPath: z.string().max(500).optional(),
  baseUrl: z.string().max(500).optional().or(z.literal("")),
  apiKey: z.string().max(500).optional().or(z.literal("")),
  config: z.record(z.unknown()).default({}),
  isDefault: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
  priority: z.number().int().default(0),
});

export type CreateModelInput = z.infer<typeof CreateModelInputSchema>;

export const UpdateModelInputSchema = CreateModelInputSchema.partial().extend({
  id: z.string().uuid(),
});

export type UpdateModelInput = z.infer<typeof UpdateModelInputSchema>;

export const ListModelsInputSchema = z.object({
  type: z.enum(MODEL_TYPES).optional(),
  tenantId: z.string().optional(),
});

export type ListModelsInput = z.infer<typeof ListModelsInputSchema>;

export const DeleteModelInputSchema = z.object({
  id: z.string().uuid(),
});

export type DeleteModelInput = z.infer<typeof DeleteModelInputSchema>;

export const GetModelInputSchema = z.object({
  id: z.string().uuid(),
});

export type GetModelInput = z.infer<typeof GetModelInputSchema>;

// ── Output schemas ─────────────────────────────────────────────────────

export const ModelOutputSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string(),
  name: z.string(),
  type: z.enum(MODEL_TYPES),
  provider: z.string(),
  vendorId: z.string().nullable(),
  vendorModelId: z.string().nullable(),
  classPath: z.string().nullable(),
  baseUrl: z.string().nullable(),
  apiKey: z.string().nullable(),
  config: z.record(z.unknown()),
  isDefault: z.boolean(),
  isEnabled: z.boolean(),
  priority: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ModelListOutputSchema = z.object({
  items: z.array(ModelOutputSchema),
});
