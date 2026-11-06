import { z } from "zod";
import { exportTrainingPairs, recordFeedback } from "../../domain/feedback/feedback.service.js";
import { protectedProcedure, router } from "../trpc.js";

export const feedbackRouter = router({
  record: protectedProcedure
    .input(
      z.object({
        canvasId: z.string().uuid().optional(),
        nodeId: z.string().uuid().optional(),
        jobId: z.string().uuid().optional(),
        assetId: z.string().uuid().optional(),
        userId: z.string().uuid().optional(),
        signal: z.string().min(1),
        metadata: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ input }) => recordFeedback(input)),

  trainingPairs: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(1000).optional() }))
    .query(async ({ input }) => ({ items: await exportTrainingPairs(input.limit ?? 200) })),
});
