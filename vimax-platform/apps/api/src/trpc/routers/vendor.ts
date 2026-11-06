import { publicProcedure, protectedProcedure, router } from "../trpc.js";
import { z } from "zod";
import {
  getAllVendors,
  getAllModels,
  getVendorForModel,
  reloadVendors,
} from "../../domain/vendor/vendor-registry.js";
import {
  getSkills,
  getArtSkills,
  getStorySkills,
  getSkill,
} from "../../domain/skill/skill-registry.js";

export const vendorRouter = router({
  /**
   * List all registered vendors.
   */
  list: publicProcedure.query(() => {
    const vendors = getAllVendors();
    return {
      items: vendors.map((v) => ({
        id: v.id,
        name: v.name,
        modelCount: v.models.length,
        hasTextRequest: !!v.textRequest,
        hasImageRequest: !!v.imageRequest,
        hasVideoRequest: !!v.videoRequest,
      })),
    };
  }),

  /**
   * List all available models across all vendors.
   */
  listModels: publicProcedure.query(() => {
    const models = getAllModels();
    return {
      items: models.map((m) => ({
        id: `${m.vendorId}:${m.id}`,
        vendorId: m.vendorId,
        name: m.name,
        type: m.type,
        maxTokens: m.maxTokens,
        supportsThinking: m.supportsThinking,
        supportsVision: m.supportsVision,
      })),
    };
  }),

  /**
   * Reload vendor plugins from disk (hot reload).
   */
  reload: protectedProcedure.mutation(() => {
    const count = reloadVendors();
    return { ok: true, vendorCount: count };
  }),
});

export const skillRouter = router({
  /**
   * List all skills, optionally filtered by type.
   */
  list: publicProcedure
    .input(z.object({ type: z.enum(["art", "story"]).optional() }))
    .query(({ input }) => {
      const skills = input.type ? getSkills(input.type) : getSkills();
      return {
        items: skills.map((s) => ({
          id: s.id,
          type: s.type,
          name: s.name,
          description: s.description,
          promptKeys: Object.keys(s.prompts),
        })),
      };
    }),

  /**
   * Get detailed skill info.
   */
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const skill = getSkill(input.id);
      if (!skill) return null;
      return {
        id: skill.id,
        type: skill.type,
        name: skill.name,
        description: skill.description,
        prompts: skill.prompts,
        body: skill.body,
      };
    }),
});
