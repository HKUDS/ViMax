import { IMAGE_MODELS, VIDEO_MODELS } from "@vimax/contracts";
import { getModels, getDefaultModel } from "../domain/model/model.service.js";
import { canvasRouter } from "./routers/canvas.js";
import { chatRouter } from "./routers/chat.js";
import { assetRouter, imageRouter } from "./routers/image.js";
import { videoRouter } from "./routers/video.js";
import { vendorRouter, skillRouter } from "./routers/vendor.js";
import { workbenchRouter } from "./routers/workbench.js";
import { novelRouter } from "./routers/novel.js";
import { authRouter } from "./routers/auth.js";
import { modelRouter } from "./routers/model.js";
import { ecomRouter } from "./routers/ecom.js";
import { knowledgeRouter } from "./routers/knowledge.js";
import { sandboxRouter } from "./routers/sandbox.js";
import { feedbackRouter } from "./routers/feedback.js";
import { router, publicProcedure } from "./trpc.js";

export const appRouter = router({
  health: publicProcedure.query(() => ({ ok: true, service: "vimax-api" })),

  /** DB-backed model configuration CRUD */
  modelConfig: modelRouter,

  /** Legacy model listing (backward-compat, now DB-backed with hardcoded fallback) */
  model: router({
    listImageModels: publicProcedure.query(async () => {
      try {
        const rows = await getModels("default", "image");
        // DB 行与 preset 同模型（class_path + vendor/init 模型名一致）时，
        // 用 preset 的稳定 id 输出，保证选择器取值与解析路径一致且不重复。
        const presetBySig = new Map(IMAGE_MODELS.map((p) => [`${p.class_path}|${p.init_args?.model ?? ""}`, p]));
        const rowSig = (m: { classPath: string | null; vendorModelId: string | null; config: Record<string, unknown> }) =>
          `${m.classPath ?? ""}|${m.vendorModelId ?? ((m.config?.init_args as Record<string, string> | undefined)?.model ?? "")}`;
        const items = rows.map((m) => {
          const preset = presetBySig.get(rowSig(m));
          if (preset) {
            return {
              id: preset.id,
              label: m.name,
              provider: m.provider,
              sizes: preset.sizes,
              supports_reference: preset.supports_reference,
              credits_per_image: preset.credits_per_image,
            };
          }
          return {
            id: m.id,
            label: m.name,
            provider: m.provider,
            sizes: (m.config as Record<string, unknown>)?.sizes ?? ["1024x1024"],
            supports_reference: (m.config as Record<string, unknown>)?.supports_reference ?? true,
            credits_per_image: 1,
          };
        });
        // 追加未收录的 preset，让免费档等新模型无需迁移即可在选择器中出现。
        const represented = new Set(rows.map(rowSig));
        for (const p of IMAGE_MODELS) {
          if (!represented.has(`${p.class_path}|${p.init_args?.model ?? ""}`)) {
            const { init_args: _init, class_path: _cls, ...rest } = p;
            items.push(rest);
          }
        }
        return { items };
      } catch {
        return {
          items: IMAGE_MODELS.map(({ init_args: _init, class_path: _cls, ...rest }) => rest),
        };
      }
    }),
    listVideoModels: publicProcedure.query(async () => {
      try {
        const rows = await getModels("default", "video");
        const presetBySig = new Map(VIDEO_MODELS.map((p) => [`${p.class_path}|${p.init_args?.model ?? ""}`, p]));
        const rowSig = (m: { classPath: string | null; vendorModelId: string | null; config: Record<string, unknown> }) =>
          `${m.classPath ?? ""}|${m.vendorModelId ?? ((m.config?.init_args as Record<string, string> | undefined)?.model ?? "")}`;
        const items = rows.map((m) => {
          const cfg = m.config as Record<string, unknown>;
          const preset = presetBySig.get(rowSig(m));
          return {
            id: preset?.id ?? m.id,
            label: m.name,
            provider: m.provider,
            maxDuration: preset?.maxDuration ?? Number(cfg?.maxDuration ?? 10),
            resolutions: preset?.resolutions ?? (cfg?.resolutions as string[] | undefined) ?? ["720p"],
            supports_reference: preset?.supports_reference ?? Boolean(cfg?.supports_reference ?? true),
            credits_per_second: preset?.credits_per_second ?? Number(cfg?.credits_per_second ?? 1),
          };
        });
        const represented = new Set(rows.map(rowSig));
        for (const p of VIDEO_MODELS) {
          if (!represented.has(`${p.class_path}|${p.init_args?.model ?? ""}`)) {
            const { init_args: _init, class_path: _cls, ...rest } = p;
            items.push(rest);
          }
        }
        return { items };
      } catch {
        return {
          items: VIDEO_MODELS.map(({ init_args: _init, class_path: _cls, ...rest }) => rest),
        };
      }
    }),
    listTextModels: publicProcedure.query(async () => {
      try {
        const items = await getModels("default", "text");
        return { items };
      } catch {
        return { items: [] };
      }
    }),
  }),

  auth: authRouter,
  image: imageRouter,
  video: videoRouter,
  asset: assetRouter,
  canvas: canvasRouter,
  chat: chatRouter,
  vendor: vendorRouter,
  skill: skillRouter,
  workbench: workbenchRouter,
  novel: novelRouter,
  ecom: ecomRouter,
  knowledge: knowledgeRouter,
  sandbox: sandboxRouter,
  feedback: feedbackRouter,
});

export type AppRouter = typeof appRouter;
