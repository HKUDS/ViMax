import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";
import {
  ingestKnowledgeDocument,
  searchKnowledge,
  seedPlatformRules,
} from "../../domain/knowledge/knowledge.service.js";

export const knowledgeRouter = router({
  ingest: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(300),
      content: z.string().min(1),
      // manual / platform_rules / upload
      sourceType: z.string().optional(),
      sourceUrl: z.string().url().optional(),
    }))
    .mutation(async ({ input }) => ingestKnowledgeDocument(input)),

  search: protectedProcedure
    .input(z.object({
      query: z.string().min(1),
      limit: z.number().int().min(1).max(20).optional(),
    }))
    .query(async ({ input }) => ({
      items: await searchKnowledge(input.query, input.limit ?? 5),
    })),

  seedPlatformRules: protectedProcedure.mutation(async () => seedPlatformRules()),
});
