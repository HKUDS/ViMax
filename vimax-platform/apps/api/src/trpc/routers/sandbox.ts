import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";
import {
  completeRun,
  createRun,
  getRun,
  listScripts,
  registerScript,
} from "../../domain/sandbox/sandbox.service.js";

export const sandboxRouter = router({
  createScript: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      code: z.string().min(1),
      description: z.string().optional(),
    }))
    .mutation(async ({ input }) => registerScript(input)),

  listScripts: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }))
    .query(async ({ input }) => ({
      items: await listScripts(input.limit ?? 50),
    })),

  createRun: protectedProcedure
    .input(z.object({
      canvasId: z.string().uuid(),
      scriptId: z.string().uuid().optional(),
      code: z.string().optional(),
      inputAssetIds: z.array(z.string().uuid()).default([]),
      name: z.string().optional(),
    }))
    .mutation(async ({ input }) => createRun(input)),

  getRun: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }))
    .query(async ({ input }) => {
      const run = await getRun(input.runId);
      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Run not found" });
      }
      return run;
    }),

  completeRun: protectedProcedure
    .input(z.object({
      runId: z.string().uuid(),
      outputAssetIds: z.array(z.string().uuid()).optional(),
      error: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      await completeRun(input.runId, {
        outputAssetIds: input.outputAssetIds,
        error: input.error,
      });
      return { ok: true };
    }),
});
