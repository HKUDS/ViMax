// ── Ad hook variants (钩子变体批量生成) ─────────────────────────────
//
// 投放 A/B 的标准动作：同一产品素材 × 多个钩子策略。一次 LLM 调用产出
// N 个变体脚本，每个落成一个兄弟 script 节点（isAd + adBrief 标注钩子
// 类型），与源节点一起接入自动管线。

import { randomUUID } from "node:crypto";
import {
  AD_HOOK_TYPES,
  buildAdVariantsPrompt,
  formatAdScript,
  parseAdVariants,
  pickVariantHookTypes,
  getAdHookType,
  type AdHookTypeId,
  type AdScriptInput,
} from "@vimax/contracts";
import { and, eq } from "drizzle-orm";
import { generateText } from "../agent/ai-service.js";
import { getDb } from "../../infrastructure/db/client.js";
import { canvasNodes } from "../../infrastructure/db/schema.js";
import { autoWireCanvas } from "./canvas.service.js";

/** Stored on every ad script node's data.adBrief by create_ad. */
export interface AdBrief {
  productDescription?: string;
  sellingPoints?: string[];
  audience?: string;
  durationSec?: number;
  hookType?: AdHookTypeId;
  ctaType?: string;
  style?: string;
}

export interface AdVariantOptions {
  /** Explicit hook types to generate (default: all types except the base). */
  hookTypes?: AdHookTypeId[];
  /** How many variants when hookTypes is not given (default 3, max 4). */
  count?: number;
}

export interface AdVariantResult {
  sourceNodeId: string;
  created: Array<{ nodeId: string; hookType: AdHookTypeId; title: string }>;
}

function variantPosition(
  source: { x: number; y: number },
  index: number,
): { x: number; y: number } {
  // Stack variants as a new column right of the source script.
  return { x: source.x + 380, y: source.y + index * 220 };
}

export async function runAdVariants(
  canvasId: string,
  nodeId: string,
  opts: AdVariantOptions = {},
): Promise<AdVariantResult> {
  const db = getDb();
  const [node] = await db
    .select()
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  if (!node || node.type !== "script") throw new Error("canvas.node_not_found");

  const data = node.data as { content?: string; adBrief?: AdBrief };
  const brief = data.adBrief ?? {};
  const productDescription = (brief.productDescription ?? "").trim();
  if (!productDescription) {
    throw new Error("ad.variants_need_product");
  }

  const baseHook: AdHookTypeId = brief.hookType ?? "pain_question";
  const count = Math.min(Math.max(opts.count ?? 3, 1), 4);
  const hookTypes = pickVariantHookTypes(
    baseHook,
    count,
    opts.hookTypes,
  );
  if (hookTypes.length === 0) throw new Error("ad.variants_no_hooks");

  const input: AdScriptInput = {
    productDescription,
    sellingPoints: brief.sellingPoints,
    audience: brief.audience,
    durationSec: brief.durationSec,
    hookType: baseHook,
    ctaType: brief.ctaType as AdScriptInput["ctaType"],
    style: brief.style,
  };
  const { system, prompt } = buildAdVariantsPrompt(input, null, hookTypes);
  const response = await generateText({
    system,
    prompt,
    temperature: 0.9,
    maxTokens: 6000,
  });

  const durationSec = brief.durationSec ?? 30;
  const variants = parseAdVariants(response.text, durationSec, hookTypes);
  if (variants.length === 0) throw new Error("ad.variants_parse_failed");

  const position = node.position as { x: number; y: number };
  const now = new Date();
  const created: AdVariantResult["created"] = [];

  for (let index = 0; index < variants.length; index++) {
    const variant = variants[index];
    const variantId = randomUUID();
    const nodeData = {
      content: formatAdScript(variant),
      status: "idle",
      isAd: true,
      adBrief: {
        ...brief,
        productDescription,
        hookType: variant.hookType,
      },
    };
    await db.insert(canvasNodes).values({
      id: variantId,
      canvasId,
      type: "script",
      position: variantPosition(position, index),
      data: nodeData,
      status: "idle",
      createdAt: now,
      updatedAt: now,
    });
    created.push({
      nodeId: variantId,
      hookType: variant.hookType,
      title: getAdHookType(variant.hookType).label,
    });
  }

  // New script nodes join the production chain like any other script node.
  await autoWireCanvas(canvasId);

  return {
    sourceNodeId: nodeId,
    created,
  };
}

/** UI/决策层提示用：还有哪些钩子类型可用于变体。 */
export function availableVariantHooks(baseHook: AdHookTypeId): string[] {
  const all = AD_HOOK_TYPES.map((h) => h.id);
  return all.filter((id) => id !== baseHook);
}
