import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";
import {
  createSku,
  createSkuSceneBatch,
  getSku,
  listSkus,
} from "../../domain/ecom/sku.service.js";
import {
  getBrandKit,
  saveBrandKit,
} from "../../domain/ecom/brandkit.service.js";

export const ecomRouter = router({
  createSku: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      category: z.string().max(100).optional(),
      attributes: z.record(z.unknown()).optional(),
      assetIds: z.array(z.string().uuid()).default([]),
      seed: z.number().int().optional(),
    }))
    .mutation(async ({ input }) => createSku(input)),

  sku: protectedProcedure
    .input(z.object({ skuId: z.string().uuid() }))
    .query(async ({ input }) => {
      const sku = await getSku(input.skuId);
      if (!sku) {
        throw new TRPCError({ code: "NOT_FOUND", message: "SKU not found" });
      }
      return sku;
    }),

  listSkus: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(200).optional() }))
    .query(async ({ input }) => ({
      items: await listSkus(input.limit ?? 50),
    })),

  skuSceneBatch: protectedProcedure
    .input(z.object({
      canvasId: z.string().uuid(),
      skuId: z.string().uuid(),
      scenes: z.array(z.string().min(1)).min(1),
      aspectRatio: z.string().optional(),
      modelId: z.string().optional(),
    }))
    .mutation(async ({ input }) =>
      createSkuSceneBatch(input.canvasId, input.skuId, input.scenes, {
        aspectRatio: input.aspectRatio,
        modelId: input.modelId,
      }),
    ),

  saveBrandKit: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      colors: z.array(z.object({
        hex: z.string().min(1),
        usage: z.string().optional(),
      })).optional(),
      fonts: z.array(z.string()).optional(),
      slogan: z.string().optional(),
      bannedWords: z.array(z.string()).optional(),
      guidelines: z.string().optional(),
      logoAssetId: z.string().uuid().optional(),
    }))
    .mutation(async ({ input }) => saveBrandKit(input)),

  getBrandKit: protectedProcedure
    .input(z.object({ kitId: z.string().uuid().optional() }))
    .query(async ({ input }) => {
      const kit = await getBrandKit(input.kitId);
      if (!kit) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Brand kit not found" });
      }
      return kit;
    }),
});
