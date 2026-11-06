import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  CreateModelInputSchema,
  UpdateModelInputSchema,
  ListModelsInputSchema,
  DeleteModelInputSchema,
} from "@vimax/contracts";
import {
  getModels,
  getModelById,
  createModel,
  updateModel,
  deleteModel,
  getDefaultModel,
} from "../../domain/model/model.service.js";
import { publicProcedure, protectedProcedure, router } from "../trpc.js";

export const modelRouter = router({
  /**
   * List all enabled models, optionally filtered by type.
   */
  list: publicProcedure
    .input(ListModelsInputSchema.optional())
    .query(async ({ input }) => {
      const tenantId = input?.tenantId ?? "default";
      const items = await getModels(tenantId, input?.type);
      return { items };
    }),

  /**
   * Get a single model by ID.
   */
  get: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const model = await getModelById(input.id);
      if (!model) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Model ${input.id} not found` });
      }
      return model;
    }),

  /**
   * Get the default model for a given type.
   */
  getDefault: publicProcedure
    .input(z.object({ type: z.enum(["text", "image", "video", "tts", "embedding"]) }))
    .query(async ({ input }) => {
      return getDefaultModel("default", input.type);
    }),

  /**
   * Create a new model configuration.
   */
  create: protectedProcedure
    .input(CreateModelInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await createModel("default", input);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create model: ${(err as Error).message}`,
        });
      }
    }),

  /**
   * Update an existing model configuration.
   */
  update: protectedProcedure
    .input(UpdateModelInputSchema)
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      const result = await updateModel(id, data);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Model ${id} not found` });
      }
      return result;
    }),

  /**
   * Delete a model configuration.
   */
  delete: protectedProcedure
    .input(DeleteModelInputSchema)
    .mutation(async ({ input }) => {
      await deleteModel(input.id);
      return { ok: true };
    }),
});
