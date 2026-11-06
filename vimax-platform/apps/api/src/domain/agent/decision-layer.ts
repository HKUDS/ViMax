// ── Agent Decision Layer ─────────────────────────────────────────────
// Adapted from Toonflow's productionAgent/index.ts runDecisionAI()
// Routes user intent to appropriate sub-agents and tools.

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import {
  streamText,
  generateText,
  type AIStreamChunk,
  type AIMessage,
  type AIUsage,
} from "./ai-service.js";
import { getDb } from "../../infrastructure/db/client.js";
import { canvases, canvasNodes, canvasEdges } from "../../infrastructure/db/schema.js";
import { autoWireCanvas } from "../canvas/canvas.service.js";
import type { CanvasMutation } from "@vimax/contracts";
import {
  buildAdScriptPrompt,
  formatAdScript,
  parseAdScript,
  getAdCtaType,
  getAdHookType,
  getAspectRatioPreset,
  getScenePreset,
  type AdCtaTypeId,
  type AdHookTypeId,
  type AdScriptInput,
} from "@vimax/contracts";
import { getDefaultModel } from "../model/model.service.js";
import { runAdVariants } from "../canvas/ad-variants.js";
import { extractProductFromUrl } from "../ad/product-url.js";
import { createSku, createSkuSceneBatch, listSkus } from "../ecom/sku.service.js";
import { saveBrandKit, getBrandKit, brandKitToConstraints } from "../ecom/brandkit.service.js";
import { searchKnowledge } from "../knowledge/knowledge.service.js";
import { rememberFact, getMemoryContext } from "../memory/memory.service.js";
import { analyzeAsset, type AnalyzePurpose } from "../evaluate/analyze.service.js";
import { createRun } from "../sandbox/sandbox.service.js";
import type { ImageEditOp } from "@vimax/contracts";
import { IMAGE_EDIT_OPS, COMPLIANCE_PLATFORMS } from "@vimax/contracts";

// ── Tool Definitions ────────────────────────────────────────────────

export const AGENT_TOOLS = {
  generate_script: {
    description: "根据用户描述生成剧本内容。输入100字以内的剧本概要描述。",
    parameters: z.object({
      prompt: z.string().describe("剧本概要描述，100字以内"),
    }),
  },
  create_ad: {
    description:
      "根据商品/产品信息生成信息流广告脚本（黄金3秒钩子→痛点→方案→CTA），并创建脚本节点。适合带货/种草/推广场景。",
    parameters: z.object({
      product_description: z.string().describe("产品/商品描述，包含品类与核心信息"),
      selling_points: z.array(z.string()).optional().describe("卖点列表，不传则自动从商品描述提炼"),
      audience: z.string().optional().describe("目标人群，如：25-35岁职场女性"),
      duration_sec: z.number().int().optional().describe("广告时长秒数：15/30/60，默认30"),
      hook_type: z
        .enum(["pain_question", "counter_intuition", "result_first", "identity", "suspense"])
        .optional()
        .describe("钩子类型：痛点提问/反常识/效果前置/身份认同/悬念冲突"),
      cta_type: z
        .enum(["limited_offer", "buy_now", "learn_more", "follow"])
        .optional()
        .describe("CTA类型：限时优惠/立即购买/点击了解/关注账号"),
      style: z.string().optional().describe("视觉风格，默认原生素人感"),
    }),
  },
  create_ad_variants: {
    description:
      "为已有的广告脚本批量生成钩子变体（每版只换开场钩子，产品/卖点/CTA 保持一致），用于投放 A/B 测试。",
    parameters: z.object({
      hook_types: z
        .array(z.enum(["pain_question", "counter_intuition", "result_first", "identity", "suspense"]))
        .optional()
        .describe("要生成的钩子类型列表，默认自动挑 3 个与当前不同的"),
      count: z.number().int().min(1).max(4).optional().describe("变体数量（未指定 hook_types 时生效），默认 3"),
    }),
  },
  extract_product: {
    description:
      "从商品详情页链接提取名称/描述/图片等公开元数据（Open Graph / JSON-LD），用于后续 create_ad。仅支持公开页面。",
    parameters: z.object({
      url: z.string().url().describe("商品详情页 URL"),
    }),
  },
  generate_storyboard: {
    description: "根据剧本内容生成分镜表和分镜面板。",
    parameters: z.object({
      prompt: z.string().describe("分镜生成指令，100字以内"),
    }),
  },
  extract_characters: {
    description: "从剧本或故事文本中提取角色信息。",
    parameters: z.object({
      prompt: z.string().describe("角色提取指令，100字以内"),
    }),
  },
  generate_image: {
    description:
      "生成一张图片（电商商品图/场景图/模特图/广告图/通用创作）。在画布上创建图片节点并提交生成任务。需要商品保真（换背景/换场景不动商品）时必须传入商品参考图。",
    parameters: z.object({
      prompt: z.string().describe("画面描述，100字以内，说清主体/构图/氛围"),
      kind: z
        .enum(["generic", "product", "scene", "model", "ad"])
        .optional()
        .describe("用途：通用/商品图/场景图/模特图/广告图，决定风格预设"),
      aspect_ratio: z
        .enum(["sq-1-1", "pt-3-4", "ls-4-3", "bn-16-9", "fv-9-16"])
        .optional()
        .describe("画幅：1:1主图/3:4详情/4:3横版/16:9Banner/9:16信息流，默认1:1"),
      scene: z
        .enum(["studio", "clean-white", "home", "outdoor", "beach", "minimal"])
        .optional()
        .describe("电商场景背景（棚拍/纯白底/家居/户外/海滩/极简）"),
      negative_prompt: z.string().optional().describe("不希望出现的元素，如 text, watermark"),
      reference_asset_ids: z
        .array(z.string())
        .optional()
        .describe("参考图资产ID列表（最多4张）：商品保真、角色一致性或基于已有图二创时传入"),
      variants: z.number().int().min(1).max(4).optional().describe("生成变体数量（1-4），默认1；>1 时进画廊供用户选用"),
    }),
  },
  activate_skill: {
    description: "激活一个美术风格或故事类型技能。",
    parameters: z.object({
      skillId: z.string().describe("技能ID，如 anime, realistic, action 等"),
    }),
  },
  edit_image: {
    description:
      "编辑一张已有图片：局部重绘（inpaint，可带遮罩）/外扩（outpaint）/抠底去背景（remove_bg）/换背景（replace_bg）。商品编辑场景换背景/局部重绘时商品主体保持不变。",
    parameters: z.object({
      asset_id: z.string().describe("要编辑的图片资产ID（画布资产清单中的 资产= 值）"),
      op: z.enum(["inpaint", "outpaint", "remove_bg", "replace_bg"]).describe("编辑操作"),
      prompt: z.string().optional().describe("编辑指令（inpaint/outpaint/replace_bg 必填方向说明；remove_bg 可省略）"),
      mask_asset_id: z.string().optional().describe("遮罩资产ID（inpaint 用，PNG alpha 遮罩；不传则整图按 prompt 编辑）"),
      negative_prompt: z.string().optional().describe("不希望出现的元素"),
    }),
  },
  burn_text: {
    description:
      "在已有图片上叠加文字图层（营销文案/卖点/价格标签），中文优先走程序化压字保证文字 100% 正确。返回任务已提交。",
    parameters: z.object({
      asset_id: z.string().describe("目标图片资产ID"),
      text_layers: z
        .array(
          z.object({
            text: z.string().describe("文字内容"),
            x: z.number().min(0).max(1).describe("锚点 X（0-1，相对图宽）"),
            y: z.number().min(0).max(1).describe("锚点 Y（0-1，相对图高）"),
            font_size: z.number().int().min(8).max(512).describe("字号（像素）"),
            color: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("文字颜色，如 #ffffff"),
            align: z.enum(["left", "center", "right"]).optional().describe("对齐方式"),
          }),
        )
        .min(1)
        .describe("文字图层列表"),
    }),
  },
  check_compliance: {
    description: "对图片做电商平台合规预检（白底/画幅占比/尺寸/比例），结果会写回节点。提交后告知用户稍候查看检查结果。",
    parameters: z.object({
      asset_id: z.string().describe("要检查的图片资产ID"),
      platforms: z
        .array(z.enum(["amazon", "tiktok_shop", "shopee", "shopify"]))
        .optional()
        .describe("目标平台，默认 amazon"),
    }),
  },
  analyze_image: {
    description: "用视觉模型分析图片：describe 生成描述（可作参考图注入 prompt 的素材）、qc 质检找瑕疵、product_fidelity 对比商品参考图判断保真度。",
    parameters: z.object({
      asset_id: z.string().describe("要分析的图片资产ID"),
      purpose: z.enum(["describe", "qc", "product_fidelity"]).describe("分析目的"),
      reference_asset_id: z.string().optional().describe("product_fidelity 时的商品参考图资产ID"),
    }),
  },
  register_sku: {
    description: "把商品图集登记为 SKU（多角度参考图 + 固定种子），后续可基于它批量生成场景图保证商品一致。",
    parameters: z.object({
      name: z.string().describe("SKU 名称"),
      category: z.string().optional().describe("品类"),
      asset_ids: z.array(z.string()).min(1).describe("商品参考图资产ID列表（按 正面/侧面/背面/细节 顺序，最多4张）"),
      attributes: z.record(z.string(), z.unknown()).optional().describe("商品属性（颜色/材质/尺寸等）"),
    }),
  },
  create_sku_batch: {
    description: "基于已登记的 SKU 批量生成不同场景的商品图（固定商品参考与种子，只换场景），用于 listing 多场景配图。",
    parameters: z.object({
      sku_id: z.string().describe("SKU ID（先用 register_sku 登记）"),
      scenes: z.array(z.string()).min(1).max(8).describe("场景描述列表，如 [\"纯白背景棚拍\", \"现代家居客厅\"]"),
      aspect_ratio: z.enum(["sq-1-1", "pt-3-4", "ls-4-3", "bn-16-9", "fv-9-16"]).optional().describe("画幅，默认主图 1:1"),
    }),
  },
  save_brand_kit: {
    description: "保存品牌套装（颜色/字体/口号/禁用元素），之后生图会自动遵循品牌约束。",
    parameters: z.object({
      name: z.string().describe("品牌名"),
      colors: z.array(z.object({ hex: z.string(), usage: z.string().optional() })).optional().describe("品牌色板"),
      fonts: z.array(z.string()).optional().describe("品牌字体"),
      slogan: z.string().optional().describe("品牌口号"),
      banned_words: z.array(z.string()).optional().describe("画面禁用元素"),
      guidelines: z.string().optional().describe("品牌视觉规范描述"),
    }),
  },
  search_assets: {
    description: "检索用户的资产与知识：knowledge 搜知识库（含平台规则）、brand 查品牌套装、sku 列商品库。",
    parameters: z.object({
      query: z.string().describe("检索词"),
      scope: z.enum(["knowledge", "brand", "sku"]).optional().describe("检索范围，默认 knowledge"),
    }),
  },
  remember: {
    description: "记住用户的持久偏好或事实（如\"我们品牌不用红色\"），写入用户记忆，后续对话自动遵循。",
    parameters: z.object({
      key: z.string().describe("记忆键，如 brand_color_rule"),
      value: z.string().describe("记忆内容"),
    }),
  },
  run_code: {
    description:
      "把一段 Python 图像处理脚本下发到用户浏览器的沙盒执行（Pyodide）：脚本从 /inputs/ 读输入图片、把产物写入 /outputs/。适合批量加水印、多尺寸导出等自定义处理。用户浏览器需在线。",
    parameters: z.object({
      code: z.string().describe("Python 代码"),
      name: z.string().optional().describe("任务名"),
      input_asset_ids: z.array(z.string()).optional().describe("输入图片资产ID列表（会挂载到 /inputs/）"),
    }),
  },
  create_canvas_nodes: {
    description: "在画布上创建新的节点。",
    parameters: z.object({
      nodes: z.array(z.object({
        type: z.enum(["script", "character", "storyboard_cell", "shot", "image", "video", "concat"]),
        data: z.record(z.unknown()).describe("节点数据"),
      })).describe("要创建的节点列表"),
    }),
  },
  run_node: {
    description: "执行画布上的某个节点（生成图片/视频等）。",
    parameters: z.object({
      nodeId: z.string().describe("要执行的节点ID"),
    }),
  },
} as const;

// ── Zone Layout (mirrors frontend dagre-layout.ts) ──────────────────
// Seven columns left → right, one per node type. Nodes stack vertically
// inside their column with a row height exceeding the tallest node, so
// generated nodes never overlap.

const ZONE_LAYOUT: Record<string, { x: number; y: number }> = {
  script: { x: 40, y: 60 },
  character: { x: 380, y: 60 },
  storyboard_cell: { x: 720, y: 60 },
  shot: { x: 1060, y: 60 },
  image: { x: 1400, y: 60 },
  video: { x: 1740, y: 60 },
  concat: { x: 2080, y: 60 },
};

const ZONE_TITLE_HEIGHT = 36;
const ZONE_ROW_HEIGHT = 240;

/** Compute position for a new node of the given type, stacking vertically
 * inside its zone column with no overlap. */
function computeNodePosition(
  nodeType: string,
  existingCount: number,
): { x: number; y: number } {
  const base = ZONE_LAYOUT[nodeType] ?? { x: 100, y: 100 };
  return {
    x: base.x + 16,
    y: base.y + ZONE_TITLE_HEIGHT + existingCount * ZONE_ROW_HEIGHT,
  };
}

// ── Node Data Normalization ──────────────────────────────────────────

/** Kind values generate_image accepts (e-commerce + generic). */
const IMAGE_TOOL_KINDS = ["generic", "product", "scene", "model", "ad"] as const;

export interface ImageNodeSpec {
  /** Persisted image-node data (contracts ImageNodeData shape). */
  nodeData: Record<string, unknown>;
  /** 1-4; >1 routes through the variant gallery instead of a single job. */
  variants: number;
}

/** Map generate_image tool args onto an image node's data. Pure so the
 * aspect/kind/scene mapping is unit-testable. */
export function buildImageNodeData(
  args: Record<string, unknown>,
  modelId: string,
): ImageNodeSpec {
  // Fallback preset always exists in ECOMMERCE_ASPECT_RATIOS.
  const aspect = getAspectRatioPreset(
    typeof args.aspect_ratio === "string" ? args.aspect_ratio : undefined,
  ) ?? getAspectRatioPreset("sq-1-1")!;
  const kind = IMAGE_TOOL_KINDS.find((k) => k === args.kind);
  const scene = getScenePreset(typeof args.scene === "string" ? args.scene : undefined);
  const references = Array.isArray(args.reference_asset_ids)
    ? args.reference_asset_ids.map(String).filter(Boolean).slice(0, 4)
    : [];
  const variants =
    typeof args.variants === "number"
      ? Math.max(1, Math.min(Math.trunc(args.variants), 4))
      : 1;

  return {
    nodeData: {
      prompt: typeof args.prompt === "string" ? args.prompt.trim() : "",
      ...(typeof args.negative_prompt === "string" && args.negative_prompt.trim()
        ? { negativePrompt: args.negative_prompt.trim() }
        : {}),
      modelId,
      size: aspect.size,
      aspectRatio: aspect.id,
      ...(kind ? { kind } : {}),
      ...(scene ? { scene: scene.id } : {}),
      ...(references.length > 0 ? { referenceAssetIds: references } : {}),
    },
    variants,
  };
}

/**
 * Models occasionally ignore the `data: object` schema and pass a plain
 * string (e.g. "镜头2：…"). Storing that raw would corrupt the node —
 * downstream editors spread it into {"0":"镜","1":"头",…}. Coerce every
 * payload into a valid object, mapping the string into the field the node
 * type actually reads.
 */
export function normalizeNodeData(type: string, data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  const text = typeof data === "string" ? data.trim() : "";
  if (!text) return {};
  switch (type) {
    case "script": return { content: text, status: "idle" };
    case "storyboard_cell": return { shotBrief: text, status: "idle" };
    case "shot": return { ffDesc: text, status: "idle" };
    case "image": return { prompt: text, status: "idle" };
    case "character": return { description: text, status: "idle" };
    default: return { note: text, status: "idle" };
  }
}

// ── Canvas Context Builder ───────────────────────────────────────────

export interface CanvasContext {
  canvasId: string;
  canvasName: string;
  nodes: Array<{
    id: string;
    type: string;
    data: Record<string, unknown>;
    status: string;
    /** Produced asset (image/video/audio) — the model passes this as a
     * generate_image reference to build on an existing image. */
    outputAssetId?: string | null;
  }>;
  edges: Array<{
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }>;
  activeSkills: string[];
}

/**
 * Latest script node's content on the canvas, so downstream tools
 * (extract_characters, generate_storyboard) operate on the ACTUAL script
 * text instead of a short instruction the model passes as `prompt`.
 */
async function getScriptContent(canvasId: string): Promise<string | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({ data: canvasNodes.data })
      .from(canvasNodes)
      .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.type, "script")))
      .orderBy(desc(canvasNodes.createdAt))
      .limit(1);
    const content = (rows[0]?.data as Record<string, unknown> | undefined)?.content;
    return typeof content === "string" && content.trim() ? content : null;
  } catch {
    return null;
  }
}

/** 最新一个广告脚本节点（钩子变体的默认基座）。 */
async function findLatestAdScriptNodeId(canvasId: string): Promise<string | null> {
  try {
    const db = getDb();
    const rows = await db
      .select({ id: canvasNodes.id, data: canvasNodes.data })
      .from(canvasNodes)
      .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.type, "script")))
      .orderBy(desc(canvasNodes.createdAt))
      .limit(10);
    const adNode = rows.find(
      (row) => (row.data as Record<string, unknown> | undefined)?.isAd === true,
    );
    return adNode?.id ?? null;
  } catch {
    return null;
  }
}

export async function buildCanvasContext(canvasId: string): Promise<CanvasContext | null> {
  try {
    const db = getDb();

    const canvasRows = await db
      .select()
      .from(canvases)
      .where(eq(canvases.id, canvasId))
      .limit(1);

    if (canvasRows.length === 0) return null;

    const nodesRows = await db
      .select()
      .from(canvasNodes)
      .where(eq(canvasNodes.canvasId, canvasId));

    const edgesRows = await db
      .select()
      .from(canvasEdges)
      .where(eq(canvasEdges.canvasId, canvasId));

    return {
      canvasId,
      canvasName: canvasRows[0]!.name,
      nodes: nodesRows.map((n) => ({
        id: n.id,
        type: n.type,
        data: n.data as Record<string, unknown>,
        status: n.status,
        ...(n.outputAssetId ? { outputAssetId: n.outputAssetId } : {}),
      })),
      edges: edgesRows.map((e) => ({
        source: e.sourceNodeId,
        target: e.targetNodeId,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
      activeSkills: [],
    };
  } catch {
    return null;
  }
}

// ── System Prompt Builder ───────────────────────────────────────────

const DECISION_SYSTEM_PROMPT = `你是一个专业的AI视频制作与电商生图助手（决策层）。你可以帮助用户完成以下任务：

## 可用工具

**创作**：1. generate_script（剧本） 2. create_ad（广告脚本） 3. create_ad_variants（钩子变体） 4. extract_product（商品链接提取） 5. generate_storyboard（分镜） 6. extract_characters（角色） 7. generate_image（生图） 8. activate_skill（美术风格） 9. create_canvas_nodes（建节点） 10. run_node（执行节点）
**电商图像**：11. edit_image（局部重绘/换底/抠底/外扩） 12. burn_text（图内文字图层，中文优先） 13. check_compliance（平台合规预检） 14. analyze_image（VLM 描述/质检/保真） 15. register_sku（登记 SKU 图集） 16. create_sku_batch（SKU 批量场景图）
**个性化与知识**：17. save_brand_kit（品牌套装） 18. search_assets（搜知识库/品牌/SKU） 19. remember（记住用户偏好） 20. run_code（浏览器沙盒跑 Python 图像脚本）

## 工作流程

当用户请求制作视频时，你应该按以下顺序调用工具：
1. 如果需要生成剧本 → generate_script
2. 如果需要角色 → extract_characters
3. 如果需要分镜 → generate_storyboard
4. 如果需要生成图片/视频 → create_canvas_nodes + run_node

## 广告创作工作流

当用户想为产品/商品/品牌制作创意广告时（关键词：广告、带货、种草、推广、投放）：
1. 调用 create_ad 生成结构化广告脚本——自动提炼卖点、默认 15 秒信息流时长、自动选择钩子策略；用户给了明确人群/时长/风格时原样传入
2. 生成后告知用户：可以点击"一键生成"跑全自动管线（分镜→角色→图片→视频→合成）
3. 用户想多版本测试时，用 create_ad_variants 批量生成钩子变体（投放 A/B 的刚需）

## 生图工作流（电商）

- 用户要商品图/白底图/场景图/模特图时，用 generate_image：按用途选 kind（product/scene/model/ad），按投放位置选 aspect_ratio（主图1:1、详情3:4、Banner16:9、信息流9:16），按氛围选 scene
- 涉及商品本身外观（换背景、换场景、营销图）时，必须传 reference_asset_ids 引用商品图（画布资产清单里 outputAssetId 或用户上传的资产），否则商品会走样
- 需要多方案对比时传 variants: 2-4，生成后引导用户在画廊中选用
- 改背景不动商品 → edit_image(replace_bg)；抠透明底 → edit_image(remove_bg)；画面加中文文案 → burn_text（不要让模型直接画中文文字）
- 上架前用 check_compliance 按平台预检；用户报了多张商品图时可先 register_sku 再 create_sku_batch 一次出全套场景图
- 用户说了长期偏好（品牌色/风格/禁用项）→ remember 记下来；正式品牌信息 → save_brand_kit

## 画布上下文

当前画布有 {nodeCount} 个节点和 {edgeCount} 条连接。
节点类型分布：{nodeTypeSummary}
{nodeManifest}

## 用户记忆与品牌约束

{memoryContext}
{brandConstraints}

## 指令

- 分析用户意图，决定需要调用哪些工具；相互独立的调用可并行发起
- 每轮工具的执行结果会作为消息回喂给你，请依据结果决定下一步，直到任务完成
- 引用画布上已有图片时，使用资产清单中的 outputAssetId
- 用中文回复用户；用户的要求不明确时先询问澄清（最多追问一次，其余用合理默认值并告知可调整）`;

// ── Decision Agent Runner ────────────────────────────────────────────

export interface DecisionToolCall {
  /** Provider tool-call id — the loop echoes it on the tool result message. */
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface DecisionAgentResult {
  /** Full text response from the agent */
  text: string;
  /** Tool calls made by the agent */
  toolCalls: DecisionToolCall[];
  /** Thinking/reasoning content */
  thinking?: string;
  /** Token usage when the provider reports it (drives the loop budget). */
  usage?: AIUsage;
}

export interface RunDecisionAgentInput {
  canvasId: string;
  /** Conversation so far (user/assistant/tool messages, oldest first). */
  messages: AIMessage[];
  onChunk: (chunk: AIStreamChunk) => void;
  modelId?: string;
  /** Current user — drives personal memory (L2 profile) injection. */
  userId?: string;
  abortSignal?: AbortSignal;
}

/** Compact listing of nodes the model can reference (assets, prompts).
 * Capped and asset-first so large canvases don't flood the context. */
export function buildNodeManifest(
  nodes: Array<{ id: string; type: string; status: string; outputAssetId?: string | null; data: Record<string, unknown> }>,
  maxLines = 20,
): string {
  const withAsset = nodes.filter((n) => n.outputAssetId);
  const withoutAsset = nodes.filter((n) => !n.outputAssetId && n.type === "image");
  const lines = [...withAsset, ...withoutAsset].slice(0, maxLines).map((n) => {
    const prompt = typeof n.data.prompt === "string" ? n.data.prompt.slice(0, 40) : "";
    const asset = n.outputAssetId ? ` 资产=${n.outputAssetId}` : "";
    return `- ${n.type} ${n.id.slice(0, 8)}… ${n.status}${asset}${prompt ? ` 「${prompt}」` : ""}`;
  });
  return lines.length > 0 ? `可引用的节点/资产：\n${lines.join("\n")}` : "画布上暂无可引用的图片资产。";
}

/**
 * Run one decision-agent turn: stream the model over the conversation
 * (tool results included) and collect its next tool calls.
 */
export async function runDecisionAgent(
  input: RunDecisionAgentInput,
): Promise<DecisionAgentResult> {
  const { canvasId, messages, onChunk, modelId, userId, abortSignal } = input;

  // Build canvas context
  const ctx = await buildCanvasContext(canvasId);

  // Personal memory (L2 profile) + brand kit constraints, both best-effort —
  // a missing migration or empty profile must never break the chat loop.
  const [memoryContext, brandConstraints] = await Promise.all([
    userId
      ? getMemoryContext(userId).catch(() => "")
      : Promise.resolve(""),
    getBrandKit()
      .then((kit) =>
        kit
          ? brandKitToConstraints({
              colors: kit.colors,
              fonts: kit.fonts,
              slogan: kit.slogan,
              bannedWords: kit.bannedWords,
            })
          : "",
      )
      .catch(() => ""),
  ]);

  const nodeTypeSummary = ctx
    ? ctx.nodes
        .reduce(
          (acc, n) => {
            acc[n.type] = (acc[n.type] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        )
    : {};

  const systemPrompt = DECISION_SYSTEM_PROMPT
    .replace("{nodeCount}", String(ctx?.nodes.length ?? 0))
    .replace("{edgeCount}", String(ctx?.edges.length ?? 0))
    .replace(
      "{nodeTypeSummary}",
      Object.entries(nodeTypeSummary)
        .map(([t, c]) => `${t}: ${c}`)
        .join(", ") || "无节点",
    )
    .replace("{nodeManifest}", ctx ? buildNodeManifest(ctx.nodes) : "")
    .replace("{memoryContext}", memoryContext || "（暂无用户记忆）")
    .replace("{brandConstraints}", brandConstraints || "（暂无品牌约束）");

  let fullText = "";
  let thinking = "";
  let usage: AIUsage | undefined;
  const toolCalls: DecisionToolCall[] = [];

  try {
    const stream = streamText({
      model: modelId,
      system: systemPrompt,
      messages,
      tools: AGENT_TOOLS,
      temperature: 0.7,
      maxTokens: 4096,
      includeUsage: true,
      abortSignal,
    });

    let toolIndex = 0;
    for await (const chunk of stream) {
      if (abortSignal?.aborted) break;
      onChunk(chunk);

      if (chunk.type === "text-delta" && chunk.text) {
        fullText += chunk.text;
      }
      if (chunk.type === "thinking-delta" && chunk.thinking) {
        thinking += chunk.thinking;
      }
      if (chunk.type === "tool-call" && chunk.toolName) {
        toolCalls.push({
          id: chunk.toolCallId ?? `call_${toolIndex++}`,
          name: chunk.toolName,
          args: chunk.toolArgs ?? {},
        });
      }
      if (chunk.type === "done" && chunk.usage) {
        usage = chunk.usage;
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    onChunk({ type: "error", error: errorMessage });
    return { text: `抱歉，AI 处理时出错: ${errorMessage}`, toolCalls: [], thinking };
  }

  return { text: fullText, toolCalls, thinking: thinking || undefined, usage };
}

// ── Execution Layer ─────────────────────────────────────────────────

export interface ToolCallOptions {
  /** Callback to broadcast canvas mutations to all connected clients */
  onCanvasMutation?: (mutation: CanvasMutation) => void;
  /** Current count of nodes by type (for computing zone positions) */
  nodeTypeCounts?: Record<string, number>;
  /** Current user — drives personal-memory tools (remember). */
  userId?: string;
  /** 会话选中的文本模型(models 表行 id)— 文本类工具优先使用 */
  modelId?: string;
}

/** Browser-sandbox execution request produced by run_code — the realtime
 * layer broadcasts it to the canvas room as `sandbox.run_requested`. */
export interface SandboxRunRequest {
  runId: string;
  name: string;
  language: string;
  code: string;
  inputAssetIds: string[];
}

/**
 * Execute a tool call from the decision agent with REAL dispatch.
 * - Text generation tools → call LLM via generateText(), create canvas nodes
 * - Asset generation → enqueue via BullMQ bridge
 * - Node execution → call node-executor.service.ts
 *
 * Returns the result to be sent back to the agent or user.
 */
export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  canvasId: string,
  opts?: ToolCallOptions,
): Promise<{
  success: boolean;
  result: unknown;
  message: string;
  /** Canvas mutation produced by this tool call (if any) */
  canvasMutation?: CanvasMutation;
  /** Browser-sandbox run to broadcast (run_code only) */
  sandboxRun?: SandboxRunRequest;
}> {
  const db = getDb();
  const onMutation = opts?.onCanvasMutation;
  const typeCounts = opts?.nodeTypeCounts ?? {};
  const textModelId = opts?.modelId;

  switch (toolName) {
    // ── create_canvas_nodes ──────────────────────────────────────────
    case "create_canvas_nodes": {
      try {
        const nodesArg = args.nodes as Array<{
          type: string;
          data?: Record<string, unknown>;
          position?: { x: number; y: number };
        }> | undefined;

        if (!nodesArg || nodesArg.length === 0) {
          return { success: false, result: null, message: "没有提供要创建的节点" };
        }

        const now = new Date();
        const mutationNodes: Array<{
          id: string;
          type: string;
          position: { x: number; y: number };
          data: Record<string, unknown>;
        }> = [];

        for (const n of nodesArg) {
          const nodeId = randomUUID();
          const nodeType = n.type;
          typeCounts[nodeType] = (typeCounts[nodeType] ?? 0) + 1;
          const position = n.position ?? computeNodePosition(nodeType, typeCounts[nodeType] - 1);

          const nodeData = normalizeNodeData(nodeType, n.data);

          await db.insert(canvasNodes).values({
            id: nodeId,
            canvasId,
            type: nodeType as never,
            position,
            data: nodeData,
            status: "idle",
            createdAt: now,
            updatedAt: now,
          });

          mutationNodes.push({ id: nodeId, type: nodeType, position, data: nodeData });
        }

        const mutation: CanvasMutation = {
          type: "nodes.add",
          nodes: mutationNodes,
        };
        onMutation?.(mutation);

        // Auto-wire type-dependency edges across the canvas (script→cell→shot→
        // image→video→concat) so generated nodes show up as a connected
        // pipeline, not scattered cards.
        const wiredEdges = await autoWireCanvas(canvasId);
        if (wiredEdges.length > 0) {
          onMutation?.({ type: "edges.add", edges: wiredEdges });
        }

        const nodeList = mutationNodes.map((n) => `${n.type}(${n.id.slice(0, 8)}…)`).join(", ");
        return {
          success: true,
          result: { created: mutationNodes.length, nodeIds: mutationNodes.map((n) => n.id) },
          message: `已在画布上创建 ${mutationNodes.length} 个节点: ${nodeList}`,
          canvasMutation: mutation,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `创建节点失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    // ── generate_script ──────────────────────────────────────────────
    case "generate_script": {
      try {
        const prompt = args.prompt as string;
        const scriptPrompt = `你是一位专业的编剧。请根据以下描述生成一个完整的剧本。

要求：
1. 包含标题、类型、人物简介
2. 完整的剧情概述（200-500字）
3. 分场大纲（3-5场）
4. 关键对话片段
5. 视觉风格建议

用户描述: ${prompt}

请用中文输出，格式清晰。`;

        const response = await generateText({
          system: "你是一位资深的中国影视编剧，擅长创作各类题材的剧本。你的回复专业、有创意、且符合工业标准。",
          prompt: scriptPrompt,
          model: textModelId,
          temperature: 0.8,
          maxTokens: 4096,
        });

        const content = response.text;

        // Create a script node on the canvas with the generated content
        typeCounts["script"] = (typeCounts["script"] ?? 0) + 1;
        const nodeId = randomUUID();
        const position = computeNodePosition("script", typeCounts["script"] - 1);
        const now = new Date();

        await db.insert(canvasNodes).values({
          id: nodeId,
          canvasId,
          type: "script",
          position,
          data: { content, status: "idle", prompt },
          status: "idle",
          createdAt: now,
          updatedAt: now,
        });

        const mutation: CanvasMutation = {
          type: "nodes.add",
          nodes: [{ id: nodeId, type: "script", position, data: { content, status: "idle", prompt } }],
        };
        onMutation?.(mutation);

        // Wire the new script to existing storyboard/character nodes, if any.
        const wiredEdges = await autoWireCanvas(canvasId);
        if (wiredEdges.length > 0) {
          onMutation?.({ type: "edges.add", edges: wiredEdges });
        }

        return {
          success: true,
          result: { nodeId, contentLength: content.length },
          message: `剧本已生成（${content.length}字），已创建脚本节点`,
          canvasMutation: mutation,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `剧本生成失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    // ── create_ad ────────────────────────────────────────────────────
    case "create_ad": {
      try {
        const input: AdScriptInput = {
          productDescription: String(args.product_description ?? ""),
          sellingPoints: Array.isArray(args.selling_points)
            ? args.selling_points.map(String)
            : undefined,
          audience: args.audience ? String(args.audience) : undefined,
          durationSec:
            typeof args.duration_sec === "number" ? args.duration_sec : undefined,
          hookType: args.hook_type as AdHookTypeId | undefined,
          ctaType: args.cta_type as AdCtaTypeId | undefined,
          style: args.style ? String(args.style) : undefined,
        };
        if (!input.productDescription.trim()) {
          return { success: false, result: null, message: "缺少商品描述，无法生成广告脚本" };
        }

        const durationSec = input.durationSec ?? 30;
        const { system, prompt } = buildAdScriptPrompt(input);
        const response = await generateText({
          system,
          prompt,
          model: textModelId,
          temperature: 0.8,
          maxTokens: 4096,
        });

        const ad = parseAdScript(response.text, durationSec);
        const content = ad ? formatAdScript(ad) : response.text.trim();
        const hook = getAdHookType(ad?.hookType ?? input.hookType);
        const cta = getAdCtaType(ad?.ctaType ?? input.ctaType);

        typeCounts["script"] = (typeCounts["script"] ?? 0) + 1;
        const nodeId = randomUUID();
        const position = computeNodePosition("script", typeCounts["script"] - 1);
        const now = new Date();
        const nodeData = {
          content,
          status: "idle",
          isAd: true,
          adBrief: {
            productDescription: input.productDescription,
            sellingPoints: ad?.sellingPoints ?? input.sellingPoints ?? [],
            audience: input.audience,
            durationSec,
            hookType: hook.id,
            ctaType: cta.id,
            style: input.style,
          },
        };

        await db.insert(canvasNodes).values({
          id: nodeId,
          canvasId,
          type: "script",
          position,
          data: nodeData,
          status: "idle",
          createdAt: now,
          updatedAt: now,
        });

        const mutation: CanvasMutation = {
          type: "nodes.add",
          nodes: [{ id: nodeId, type: "script", position, data: nodeData }],
        };
        onMutation?.(mutation);

        const wiredEdges = await autoWireCanvas(canvasId);
        if (wiredEdges.length > 0) {
          onMutation?.({ type: "edges.add", edges: wiredEdges });
        }

        return {
          success: true,
          result: { nodeId, durationSec, hookType: hook.id, ctaType: cta.id },
          message: `广告脚本已生成（${durationSec} 秒 · ${hook.label}钩子 · ${cta.label}），已创建脚本节点。可以让用户点击"一键生成"跑全自动管线出片。`,
          canvasMutation: mutation,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `广告脚本生成失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    // ── create_ad_variants ───────────────────────────────────────────
    case "create_ad_variants": {
      try {
        const nodeId = await findLatestAdScriptNodeId(canvasId);
        if (!nodeId) {
          return { success: false, result: null, message: "画布上还没有广告脚本，请先用 create_ad 生成" };
        }
        const hookTypes = Array.isArray(args.hook_types)
          ? (args.hook_types as AdHookTypeId[])
          : undefined;
        const result = await runAdVariants(canvasId, nodeId, {
          hookTypes,
          count: typeof args.count === "number" ? args.count : undefined,
        });
        const hooksLabel = result.created.map((v) => getAdHookType(v.hookType).label).join("、");
        return {
          success: true,
          result,
          message: `已生成 ${result.created.length} 个钩子变体脚本节点（${hooksLabel}），每个都可以单独跑一键生成做 A/B 测试。`,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `钩子变体生成失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    // ── extract_product ──────────────────────────────────────────────
    case "extract_product": {
      try {
        const url = String(args.url ?? "");
        const product = await extractProductFromUrl(url);
        return {
          success: true,
          result: product,
          message: [
            `已从链接提取商品信息：`,
            `名称：${product.name}`,
            product.brand ? `品牌：${product.brand}` : null,
            product.price ? `价格：${product.price}` : null,
            product.description ? `描述：${product.description.slice(0, 200)}` : null,
            `（提取到 ${product.imageUrls.length} 张商品图，可手动下载后上传画布作参考图）`,
          ]
            .filter(Boolean)
            .join("\n"),
        };
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        const hint = reason.startsWith("product_url.")
          ? "该页面不可提取（需要登录/反爬拦截/无公开元数据）。请让用户直接粘贴商品名称和卖点描述。"
          : reason;
        return { success: false, result: null, message: `商品链接提取失败：${hint}` };
      }
    }

    // ── generate_storyboard ──────────────────────────────────────────
    case "generate_storyboard": {
      try {
        const prompt = (await getScriptContent(canvasId)) ?? (args.prompt as string);
        const sbPrompt = `你是一位专业的分镜师。请根据以下描述生成分镜表。

要求：
1. 将内容拆分为5-8个镜头
2. 每个镜头包含：镜头编号、景别（远景/全景/中景/近景/特写）、摄影机运动、画面描述、时长（秒）
3. 用中文输出

输入: ${prompt}

请按以下JSON格式输出（仅输出JSON，不要其他内容）：
{
  "shots": [
    { "index": 1, "shotType": "近景", "camera": "固定", "description": "...", "durationSec": 4 },
    ...
  ]
}`;

        const response = await generateText({
          system: "你是一位专业的分镜师。你只输出有效的JSON，不包含任何其他文字。",
          prompt: sbPrompt,
          model: textModelId,
          temperature: 0.7,
          maxTokens: 4096,
        });

        // Try to parse JSON, fall back to text if not valid JSON
        let shots: Array<Record<string, unknown>> = [];
        try {
          const jsonMatch = response.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            shots = (parsed.shots as Array<Record<string, unknown>>) ?? [];
          }
        } catch {
          // Fallback: create a single storyboard cell with the raw text
          shots = [{ index: 1, shotType: "中景", camera: "固定", description: response.text, durationSec: 5 }];
        }

        const now = new Date();
        const mutationNodes: Array<{
          id: string;
          type: string;
          position: { x: number; y: number };
          data: Record<string, unknown>;
        }> = [];

        for (const shot of shots) {
          const nodeId = randomUUID();
          const idx = (shot.index as number) ?? shots.indexOf(shot) + 1;
          typeCounts["storyboard_cell"] = (typeCounts["storyboard_cell"] ?? 0) + 1;
          const position = computeNodePosition("storyboard_cell", typeCounts["storyboard_cell"] - 1);

          const nodeData = {
            shotBrief: shot.description ?? "",
            cameraIdx: idx,
            shotType: shot.shotType ?? "中景",
            camera: shot.camera ?? "固定",
            durationSec: shot.durationSec ?? 5,
            status: "idle",
          };

          await db.insert(canvasNodes).values({
            id: nodeId,
            canvasId,
            type: "storyboard_cell",
            position,
            data: nodeData,
            status: "idle",
            createdAt: now,
            updatedAt: now,
          });

          mutationNodes.push({ id: nodeId, type: "storyboard_cell", position, data: nodeData });
        }

        const mutation: CanvasMutation | undefined = mutationNodes.length > 0
          ? { type: "nodes.add", nodes: mutationNodes }
          : undefined;
        if (mutation) onMutation?.(mutation);

        // Wire storyboard cells to the script node and any existing shots.
        const wiredEdges = await autoWireCanvas(canvasId);
        if (wiredEdges.length > 0) onMutation?.({ type: "edges.add", edges: wiredEdges });

        return {
          success: true,
          result: { shotCount: mutationNodes.length },
          message: `分镜已生成，共 ${mutationNodes.length} 个镜头`,
          ...(mutation ? { canvasMutation: mutation } : {}),
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `分镜生成失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    // ── extract_characters ───────────────────────────────────────────
    case "extract_characters": {
      try {
        const prompt = (await getScriptContent(canvasId)) ?? (args.prompt as string);
        const charPrompt = `从以下文本中提取所有角色信息。

输入文本: ${prompt}

请按以下JSON格式输出（仅输出JSON，不要其他内容）：
{
  "characters": [
    { "name": "角色名", "description": "外貌、性格、背景等" },
    ...
  ]
}`;

        const response = await generateText({
          system: "你是一个专业的角色分析工具。你只输出有效的JSON。",
          prompt: charPrompt,
          model: textModelId,
          temperature: 0.5,
          maxTokens: 4096,
        });

        let characters: Array<Record<string, unknown>> = [];
        try {
          const jsonMatch = response.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            characters = (parsed.characters as Array<Record<string, unknown>>) ?? [];
          }
        } catch {
          characters = [{ name: "主角", description: response.text.slice(0, 200) }];
        }

        const now = new Date();
        const mutationNodes: Array<{
          id: string;
          type: string;
          position: { x: number; y: number };
          data: Record<string, unknown>;
        }> = [];

        for (const char of characters) {
          const nodeId = randomUUID();
          typeCounts["character"] = (typeCounts["character"] ?? 0) + 1;
          const position = computeNodePosition("character", typeCounts["character"] - 1);

          const nodeData = {
            name: (char.name as string) ?? "未命名角色",
            description: (char.description as string) ?? "",
            status: "idle",
          };

          await db.insert(canvasNodes).values({
            id: nodeId,
            canvasId,
            type: "character",
            position,
            data: nodeData,
            status: "idle",
            createdAt: now,
            updatedAt: now,
          });

          mutationNodes.push({ id: nodeId, type: "character", position, data: nodeData });
        }

        const mutation: CanvasMutation | undefined = mutationNodes.length > 0
          ? { type: "nodes.add", nodes: mutationNodes }
          : undefined;
        if (mutation) onMutation?.(mutation);

        // Wire characters to the script node and any existing shots.
        const wiredEdges = await autoWireCanvas(canvasId);
        if (wiredEdges.length > 0) onMutation?.({ type: "edges.add", edges: wiredEdges });

        return {
          success: true,
          result: { characterCount: mutationNodes.length },
          message: `已提取 ${mutationNodes.length} 个角色`,
          ...(mutation ? { canvasMutation: mutation } : {}),
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `角色提取失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    // ── generate_image ───────────────────────────────────────────────
    case "generate_image": {
      try {
        const defaultModel = await getDefaultModel("default", "image");
        const { nodeData, variants } = buildImageNodeData(args, defaultModel.id);
        if (!nodeData.prompt) {
          return { success: false, result: null, message: "缺少画面描述 prompt，无法生成图片" };
        }

        const nodeId = randomUUID();
        typeCounts["image"] = (typeCounts["image"] ?? 0) + 1;
        const position = computeNodePosition("image", typeCounts["image"] - 1);
        const now = new Date();

        await db.insert(canvasNodes).values({
          id: nodeId,
          canvasId,
          type: "image",
          position,
          data: nodeData,
          status: "idle",
          createdAt: now,
          updatedAt: now,
        });

        const mutation: CanvasMutation = {
          type: "nodes.add",
          nodes: [{ id: nodeId, type: "image", position, data: nodeData }],
        };
        onMutation?.(mutation);

        // Wire the image node to any existing shots (shot→image).
        const wiredEdges = await autoWireCanvas(canvasId);
        if (wiredEdges.length > 0) onMutation?.({ type: "edges.add", edges: wiredEdges });

        const refCount = Array.isArray(nodeData.referenceAssetIds)
          ? nodeData.referenceAssetIds.length
          : 0;
        const sizeLabel = `${nodeData.size}${refCount > 0 ? ` · ${refCount} 张参考图` : ""}`;

        if (variants > 1) {
          const { runVariants } = await import("../canvas/node-executor.service.js");
          const { jobIds } = await runVariants(canvasId, nodeId, variants);
          return {
            success: true,
            result: { nodeId, jobIds, size: nodeData.size, variants },
            message: `已创建图片节点（${sizeLabel}）并提交 ${variants} 个变体，完成后请在画廊中对比选用。`,
            canvasMutation: mutation,
          };
        }

        const { runNode } = await import("../canvas/node-executor.service.js");
        const result = await runNode({ canvas_id: canvasId, node_id: nodeId });

        return {
          success: true,
          result: { jobId: result.job_id, nodeId, size: nodeData.size },
          message: `已创建图片节点（${sizeLabel}），生成任务已提交。`,
          canvasMutation: mutation,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `图片生成提交失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    // ── run_node ─────────────────────────────────────────────────────
    case "run_node": {
      try {
        const nodeId = args.nodeId as string;
        // Dynamically import node executor to avoid circular deps
        const { runNode } = await import(
          "../canvas/node-executor.service.js"
        );

        const result = await runNode({
          canvas_id: canvasId,
          node_id: nodeId,
        });

        return {
          success: true,
          result: { nodeId, ...result },
          message: `节点 ${nodeId.slice(0, 8)}… 执行完成`,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `节点执行失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    // ── activate_skill ───────────────────────────────────────────────
    case "activate_skill": {
      const skillId = args.skillId as string;
      // Try to load skill from registry
      let skillInfo = "";
      try {
        const { getSkill } = await import("../skill/skill-registry.js");
        const skill = getSkill(skillId);
        if (skill) {
          skillInfo = `已加载技能「${skill.name}」(${skill.type}): ${skill.description}`;
        } else {
          skillInfo = `技能「${skillId}」已激活（提示：可用的美术风格: anime, realistic, cinematic, comic, watercolor, oil-painting, ink-wash, flat-design, claymation, pixel-art, noir；故事类型: action, romance, sci-fi, fantasy, mystery, comedy, horror, documentary, historical, slice-of-life, musical）`;
        }
      } catch {
        skillInfo = `技能「${skillId}」已激活`;
      }

      return {
        success: true,
        result: { skillId, loaded: skillInfo.includes("已加载") },
        message: skillInfo,
      };
    }

    // ── edit_image / burn_text / check_compliance（P1 电商图像后处理） ──
    case "edit_image": {
      try {
        const assetId = String(args.asset_id ?? "");
        const op = args.op as ImageEditOp;
        if (!assetId) return { success: false, result: null, message: "缺少 asset_id" };
        if (!IMAGE_EDIT_OPS.includes(op)) {
          return { success: false, result: null, message: `不支持的编辑操作: ${String(args.op)}` };
        }
        if (op !== "remove_bg" && !String(args.prompt ?? "").trim()) {
          return { success: false, result: null, message: `${op} 需要提供编辑指令 prompt` };
        }
        const defaultModel = await getDefaultModel("default", "image");
        const nodeId = randomUUID();
        typeCounts["image"] = (typeCounts["image"] ?? 0) + 1;
        const position = computeNodePosition("image", typeCounts["image"] - 1);
        const now = new Date();
        const { getAssetSize } = await import("../canvas/node-executor.service.js");
        const size = await getAssetSize(assetId);
        const nodeData = {
          prompt: String(args.prompt ?? ""),
          modelId: defaultModel.id,
          size,
          editOp: op,
          sourceAssetId: assetId,
          ...(typeof args.mask_asset_id === "string" && args.mask_asset_id
            ? { maskAssetId: args.mask_asset_id }
            : {}),
          ...(typeof args.negative_prompt === "string" && args.negative_prompt
            ? { negativePrompt: args.negative_prompt }
            : {}),
        };

        await db.insert(canvasNodes).values({
          id: nodeId, canvasId, type: "image", position, data: nodeData,
          status: "idle", createdAt: now, updatedAt: now,
        });
        const mutation: CanvasMutation = {
          type: "nodes.add",
          nodes: [{ id: nodeId, type: "image", position, data: nodeData }],
        };
        onMutation?.(mutation);

        const { runNode } = await import("../canvas/node-executor.service.js");
        await runNode({ canvas_id: canvasId, node_id: nodeId });
        return {
          success: true,
          result: { nodeId, op },
          message: `已提交 ${op} 编辑任务（源图 ${assetId.slice(0, 8)}…），完成后新图会出现在画布上。`,
          canvasMutation: mutation,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `图片编辑提交失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    case "burn_text": {
      try {
        const assetId = String(args.asset_id ?? "");
        const layers = Array.isArray(args.text_layers) ? args.text_layers : [];
        if (!assetId || layers.length === 0) {
          return { success: false, result: null, message: "缺少 asset_id 或 text_layers" };
        }
        const nodeId = randomUUID();
        typeCounts["image"] = (typeCounts["image"] ?? 0) + 1;
        const position = computeNodePosition("image", typeCounts["image"] - 1);
        const now = new Date();
        const { getAssetSize } = await import("../canvas/node-executor.service.js");
        const size = await getAssetSize(assetId);
        const nodeData = {
          prompt: "text overlay",
          modelId: "pil",
          size,
          sourceAssetId: assetId,
          textLayers: layers,
        };

        await db.insert(canvasNodes).values({
          id: nodeId, canvasId, type: "image", position, data: nodeData,
          status: "idle", createdAt: now, updatedAt: now,
        });
        const mutation: CanvasMutation = {
          type: "nodes.add",
          nodes: [{ id: nodeId, type: "image", position, data: nodeData }],
        };
        onMutation?.(mutation);

        const { runNode } = await import("../canvas/node-executor.service.js");
        await runNode({ canvas_id: canvasId, node_id: nodeId });
        return {
          success: true,
          result: { nodeId, layers: layers.length },
          message: `已提交文字压图任务（${layers.length} 个文字图层），中文文案由程序渲染保证 100% 正确。`,
          canvasMutation: mutation,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `文字压图提交失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    case "check_compliance": {
      try {
        const assetId = String(args.asset_id ?? "");
        if (!assetId) return { success: false, result: null, message: "缺少 asset_id" };
        const platforms = (Array.isArray(args.platforms) ? args.platforms : ["amazon"])
          .map(String)
          .filter((p): p is (typeof COMPLIANCE_PLATFORMS)[number] =>
            (COMPLIANCE_PLATFORMS as readonly string[]).includes(p));
        if (platforms.length === 0) {
          return { success: false, result: null, message: "没有可识别的平台" };
        }
        const nodeId = randomUUID();
        typeCounts["image"] = (typeCounts["image"] ?? 0) + 1;
        const position = computeNodePosition("image", typeCounts["image"] - 1);
        const now = new Date();
        const { getAssetSize } = await import("../canvas/node-executor.service.js");
        const size = await getAssetSize(assetId);
        const nodeData = {
          prompt: "compliance check",
          modelId: "compliance",
          size,
          sourceAssetId: assetId,
          compliancePlatforms: platforms,
        };

        await db.insert(canvasNodes).values({
          id: nodeId, canvasId, type: "image", position, data: nodeData,
          status: "idle", createdAt: now, updatedAt: now,
        });
        const mutation: CanvasMutation = {
          type: "nodes.add",
          nodes: [{ id: nodeId, type: "image", position, data: nodeData }],
        };
        onMutation?.(mutation);

        const { runNode } = await import("../canvas/node-executor.service.js");
        await runNode({ canvas_id: canvasId, node_id: nodeId });
        return {
          success: true,
          result: { nodeId, platforms },
          message: `已提交 ${platforms.join("/")} 合规预检，结果会写回该节点（白底/画幅占比/尺寸/比例）。`,
          canvasMutation: mutation,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `合规预检提交失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    // ── analyze_image（VLM 同步分析） ─────────────────────────────────
    case "analyze_image": {
      try {
        const assetId = String(args.asset_id ?? "");
        const purpose = args.purpose as AnalyzePurpose;
        if (!assetId || !["describe", "qc", "product_fidelity"].includes(purpose)) {
          return { success: false, result: null, message: "缺少 asset_id 或 purpose 非法" };
        }
        const analysis = await analyzeAsset(
          assetId,
          purpose,
          typeof args.reference_asset_id === "string" && args.reference_asset_id
            ? { referenceAssetId: args.reference_asset_id }
            : undefined,
        );
        const fidelity = analysis.productFidelity !== undefined
          ? `\n商品保真度: ${(analysis.productFidelity * 100).toFixed(0)}%`
          : "";
        return {
          success: true,
          result: analysis,
          message: `图片分析（${purpose}）：\n${analysis.description}\n问题: ${analysis.issues.length > 0 ? analysis.issues.join("；") : "未发现"}${fidelity}`,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `图片分析失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    // ── SKU 批量（register_sku / create_sku_batch） ──────────────────
    case "register_sku": {
      try {
        const assetIds = Array.isArray(args.asset_ids) ? args.asset_ids.map(String).slice(0, 4) : [];
        if (!String(args.name ?? "").trim() || assetIds.length === 0) {
          return { success: false, result: null, message: "缺少 name 或 asset_ids" };
        }
        const sku = await createSku({
          name: String(args.name),
          category: typeof args.category === "string" ? args.category : undefined,
          attributes: args.attributes as Record<string, unknown> | undefined,
          assetIds,
        });
        return {
          success: true,
          result: sku,
          message: `SKU 已登记（${assetIds.length} 张参考图，种子已锁定）。之后可用 create_sku_batch 批量出场景图。`,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `SKU 登记失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    case "create_sku_batch": {
      try {
        const skuId = String(args.sku_id ?? "");
        const scenes = Array.isArray(args.scenes) ? args.scenes.map(String).slice(0, 8) : [];
        if (!skuId || scenes.length === 0) {
          return { success: false, result: null, message: "缺少 sku_id 或 scenes" };
        }
        const batch = await createSkuSceneBatch(canvasId, skuId, scenes, {
          aspectRatio: typeof args.aspect_ratio === "string" ? args.aspect_ratio : undefined,
        });
        return {
          success: true,
          result: batch,
          message: `已为 SKU 批量提交 ${batch.nodeIds.length} 个场景图任务（种子 ${batch.seed} 锁定，商品参考图强约束），生成任务进行中。`,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `SKU 批量生成失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    // ── 个性化与知识（save_brand_kit / search_assets / remember） ────
    case "save_brand_kit": {
      try {
        const name = String(args.name ?? "").trim();
        if (!name) return { success: false, result: null, message: "缺少品牌名" };
        const colors = Array.isArray(args.colors)
          ? (args.colors as Array<{ hex?: unknown; usage?: unknown }>).map((c) => ({
              hex: String(c.hex ?? ""),
              ...(c.usage ? { usage: String(c.usage) } : {}),
            })).filter((c) => /^#[0-9a-fA-F]{6}$/.test(c.hex))
          : undefined;
        const kit = await saveBrandKit({
          name,
          ...(colors && colors.length > 0 ? { colors } : {}),
          ...(Array.isArray(args.fonts) ? { fonts: args.fonts.map(String) } : {}),
          ...(typeof args.slogan === "string" ? { slogan: args.slogan } : {}),
          ...(Array.isArray(args.banned_words) ? { bannedWords: args.banned_words.map(String) } : {}),
          ...(typeof args.guidelines === "string" ? { guidelines: args.guidelines } : {}),
        });
        return {
          success: true,
          result: kit,
          message: `品牌套装「${name}」已保存，之后生图会自动遵循品牌约束。`,
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `品牌套装保存失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    case "search_assets": {
      try {
        const query = String(args.query ?? "").trim();
        const scope = String(args.scope ?? "knowledge");
        if (!query) return { success: false, result: null, message: "缺少检索词" };

        if (scope === "brand") {
          const kit = await getBrandKit();
          if (!kit) return { success: true, result: null, message: "尚未保存品牌套装。" };
          return {
            success: true,
            result: kit,
            message: `品牌套装「${kit.name}」：\n${brandKitToConstraints({
              colors: kit.colors, fonts: kit.fonts, slogan: kit.slogan, bannedWords: kit.bannedWords,
            })}`,
          };
        }
        if (scope === "sku") {
          const skus = await listSkus(20);
          const matched = skus.filter((s) => !s || s.name.includes(query) || (s.category ?? "").includes(query));
          const lines = (matched.length > 0 ? matched : skus)
            .map((s) => `- ${s!.name}（${s!.id.slice(0, 8)}…）${s!.category ?? ""}`)
            .join("\n");
          return { success: true, result: matched, message: `SKU 检索结果：\n${lines || "（空）"}` };
        }
        const hits = await searchKnowledge(query, 5);
        if (hits.length === 0) {
          return { success: true, result: [], message: `知识库中没有关于「${query}」的内容。` };
        }
        const lines = hits.map((h) => `- [${h.title}] ${h.content.slice(0, 160)}`).join("\n");
        return { success: true, result: hits, message: `知识库检索结果：\n${lines}` };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `资产检索失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    case "remember": {
      const key = String(args.key ?? "").trim();
      const value = String(args.value ?? "").trim();
      if (!key || !value) return { success: false, result: null, message: "缺少 key 或 value" };
      if (!opts?.userId) return { success: false, result: null, message: "无法识别当前用户，无法保存记忆" };
      await rememberFact(opts.userId, key, value);
      return { success: true, result: { key, value }, message: `已记住：${key} = ${value}` };
    }

    // ── run_code（浏览器沙盒） ───────────────────────────────────────
    case "run_code": {
      try {
        const code = String(args.code ?? "").trim();
        if (!code) return { success: false, result: null, message: "缺少 code" };
        const inputAssetIds = Array.isArray(args.input_asset_ids)
          ? args.input_asset_ids.map(String).filter(Boolean)
          : [];
        const run = await createRun({
          canvasId,
          code,
          name: typeof args.name === "string" && args.name ? args.name : "sandbox-run",
          inputAssetIds,
        });
        return {
          success: true,
          result: { runId: run.runId },
          message: "已把脚本下发到浏览器沙盒（Pyodide）执行，产物会自动入库并回传。",
          sandboxRun: {
            runId: run.runId,
            name: run.name,
            language: run.language,
            code: run.code,
            inputAssetIds,
          },
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          message: `沙盒任务下发失败: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    }

    default:
      return {
        success: false,
        result: null,
        message: `未知工具: ${toolName}`,
      };
  }
}
