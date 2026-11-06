// ── Workflow templates ─────────────────────────────────────────────
//
// Pre-built canvas graphs users can drop onto a blank canvas — the
// liblibtv-style "pick a template → fill in → generate" entry point.
//
// Templates compose EXISTING node types (no new schema, no migration):
// instantiation just clones the template's nodes (fresh UUIDs) and
// rewires its edges to the new ids. All execution/cache/cascade
// machinery built elsewhere applies unchanged.

import { randomUUID } from "node:crypto";
import type {
  CanvasNodeType,
  InstantiatedEdge,
  InstantiatedNode,
  TemplateCategory,
  TemplateSummary,
} from "@vimax/contracts";

// Re-export the shared DTOs so callers can import everything from here.
export type {
  InstantiatedEdge,
  InstantiatedNode,
  TemplateCategory,
  TemplateSummary,
};

// ── Template model ─────────────────────────────────────────────────

/** A node inside a template. `id` is stable WITHIN the template only. */
export interface TemplateNode {
  id: string;
  type: CanvasNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
  /** Human-readable role, shown in the picker. */
  label: string;
}

export interface TemplateEdge {
  id: string;
  source: string; // TemplateNode.id
  target: string; // TemplateNode.id
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

/** Metadata for the picker — omits the heavy graph payload. */
export function summarizeTemplate(t: WorkflowTemplate): TemplateSummary {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    nodeCount: t.nodes.length,
  };
}

// ── Seed templates ─────────────────────────────────────────────────
// Positions are laid out left → right; the canvas places them as-is.

export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    id: "ecommerce-product-scene",
    name: "电商商品场景图",
    description: "上传商品白底图 → 一键生成场景图与动态视频",
    category: "ecommerce",
    nodes: [
      {
        id: "product",
        type: "image",
        position: { x: 0, y: 0 },
        data: {
          prompt: "商品白底图，干净，高清，电商主图质感",
          size: "1024x1024",
        },
        label: "商品图（替换为你的商品）",
      },
      {
        id: "scene",
        type: "image",
        position: { x: 320, y: 0 },
        data: {
          prompt: "商品置于海滩场景，黄金时刻光线，商业摄影质感，景深",
          size: "1024x1024",
        },
        label: "场景图",
      },
      {
        id: "promo",
        type: "video",
        position: { x: 640, y: 0 },
        data: { motionPreset: "zoom_in", durationSec: 4 },
        label: "动态视频",
      },
    ],
    edges: [
      { id: "e1", source: "product", target: "scene", sourceHandle: "output", targetHandle: "reference" },
      { id: "e2", source: "scene", target: "promo", sourceHandle: "output", targetHandle: "first_frame" },
    ],
  },
  {
    id: "ecommerce-main-image",
    name: "电商主图（1:1 棚拍）",
    description: "商品白底主图 + 详情场景图，1:1 主图比例，棚拍质感",
    category: "ecommerce",
    nodes: [
      {
        id: "main",
        type: "image",
        position: { x: 0, y: 0 },
        data: {
          prompt: "高质量电商商品主图，细节清晰，质感出色",
          size: "1024x1024",
          kind: "product",
          aspectRatio: "sq-1-1",
          scene: "clean-white",
        },
        label: "商品主图",
      },
      {
        id: "detail",
        type: "image",
        position: { x: 320, y: 0 },
        data: {
          prompt: "商品使用场景，突出卖点",
          size: "1024x1536",
          kind: "scene",
          aspectRatio: "pt-3-4",
          scene: "home",
        },
        label: "详情场景图",
      },
    ],
    edges: [
      { id: "e1", source: "main", target: "detail", sourceHandle: "output", targetHandle: "reference" },
    ],
  },
  {
    id: "ecommerce-feed-video",
    name: "电商信息流视频（9:16）",
    description: "商品图 → 9:16 信息流短视频，适合抖音/小红书投放",
    category: "ecommerce",
    nodes: [
      {
        id: "product",
        type: "image",
        position: { x: 0, y: 0 },
        data: {
          prompt: "商品特写，吸引眼球，适合信息流",
          size: "864x1536",
          kind: "product",
          aspectRatio: "fv-9-16",
          scene: "studio",
        },
        label: "商品图（9:16）",
      },
      {
        id: "feed",
        type: "video",
        position: { x: 320, y: 0 },
        data: { motionPreset: "zoom_in", durationSec: 5 },
        label: "信息流视频",
      },
    ],
    edges: [
      { id: "e1", source: "product", target: "feed", sourceHandle: "output", targetHandle: "first_frame" },
    ],
  },
  {
    id: "short-drama-shot",
    name: "短剧·单镜头",
    description: "角色 → 镜头 → 首帧 → 视频，一条完整的短剧镜头流水线",
    category: "short-drama",
    nodes: [
      {
        id: "hero",
        type: "character",
        position: { x: 0, y: 0 },
        data: { name: "主角", description: "请填写角色外貌与服饰" },
        label: "角色",
      },
      {
        id: "shot",
        type: "shot",
        position: { x: 320, y: 0 },
        data: {
          ffDesc: "角色出场，中景，环境光",
          lfDesc: "",
          motionDesc: "缓慢推近",
          audioDesc: "",
          variationType: "medium",
        },
        label: "镜头",
      },
      {
        id: "frame",
        type: "image",
        position: { x: 640, y: 0 },
        data: { prompt: "角色中景出场镜头，电影感", size: "1600x900" },
        label: "首帧",
      },
      {
        id: "clip",
        type: "video",
        position: { x: 960, y: 0 },
        data: { motionPreset: "zoom_in", durationSec: 4 },
        label: "视频",
      },
    ],
    edges: [
      { id: "e1", source: "hero", target: "shot", targetHandle: "reference" },
      { id: "e2", source: "shot", target: "frame", sourceHandle: "first_frame", targetHandle: "reference" },
      { id: "e3", source: "frame", target: "clip", sourceHandle: "output", targetHandle: "first_frame" },
    ],
  },
  {
    id: "ad-key-visual",
    name: "创意广告·关键画面",
    description: "创意脚本 → 关键画面 → 动态视频，快速出广告素材",
    category: "ad",
    nodes: [
      {
        id: "idea",
        type: "script",
        position: { x: 0, y: 0 },
        data: { content: "广告创意：一句话卖点 + 视觉风格描述" },
        label: "创意脚本",
      },
      {
        id: "keyvisual",
        type: "image",
        position: { x: 320, y: 0 },
        data: { prompt: "广告关键画面，强视觉冲击，品牌调性，高清", size: "1024x1024" },
        label: "关键画面",
      },
      {
        id: "motion",
        type: "video",
        position: { x: 640, y: 0 },
        data: { motionPreset: "zoom_in", durationSec: 5 },
        label: "动态视频",
      },
    ],
    edges: [
      { id: "e1", source: "idea", target: "keyvisual" },
      { id: "e2", source: "keyvisual", target: "motion", sourceHandle: "output", targetHandle: "first_frame" },
    ],
  },
  {
    id: "creative-asset-pack",
    name: "创意素材包（人物/场景/道具）",
    description: "人物形象、场景概念、道具素材一次配齐，作为可复用的参考素材库",
    category: "general",
    nodes: [
      {
        id: "portrait",
        type: "image",
        position: { x: 0, y: 0 },
        data: {
          prompt: "主要人物形象，正面半身，气质鲜明",
          kind: "portrait",
          size: "1024x1536",
        },
        label: "人物形象",
      },
      {
        id: "environment",
        type: "image",
        position: { x: 320, y: 0 },
        data: {
          prompt: "故事主场景概念图，氛围光影",
          kind: "environment",
          size: "1600x900",
        },
        label: "场景概念",
      },
      {
        id: "prop",
        type: "image",
        position: { x: 640, y: 0 },
        data: {
          prompt: "关键道具，干净背景，细节清晰",
          kind: "prop",
          size: "1024x1024",
        },
        label: "道具素材",
      },
    ],
    edges: [],
  },

  // ── 广告模板（直效 DR 结构：hook → 方案 → CTA，口播写在镜头的 audioDesc）──

  {
    id: "ad-ugc-15s",
    name: "广告·15秒 UGC 口播带货（9:16）",
    description: "黄金3秒钩子→产品方案→CTA，信息流投放标准结构；上传商品图后一键全自动出片",
    category: "ad",
    nodes: [
      {
        id: "script",
        type: "script",
        position: { x: 0, y: 0 },
        data: {
          content: [
            "【15秒 UGC 口播带货脚本】",
            "产品：请替换为你的商品（一句话：品类 + 核心差异点）",
            "",
            "【钩子 0-3秒】效果前置：直接展示使用后的结果",
            "口播：还在为___烦恼？用它 3 秒搞定",
            "",
            "【方案 3-11秒】产品露出 + 核心卖点演示",
            "口播：它___（卖点1），___（卖点2），实测___",
            "",
            "【CTA 11-15秒】行动指令",
            "口播：同款链接就在下方，直接拍",
          ].join("\n"),
          status: "idle",
          isAd: true,
        },
        label: "广告脚本（替换商品与口播）",
      },
      {
        id: "product",
        type: "image",
        position: { x: 0, y: 240 },
        data: {
          prompt: "商品特写，原生气口，信息流广告质感，高清",
          size: "864x1536",
          kind: "product",
          aspectRatio: "fv-9-16",
        },
        label: "商品图（可上传替换）",
      },
      {
        id: "shot-hook",
        type: "shot",
        position: { x: 320, y: 0 },
        data: {
          ffDesc: "手持商品对镜头展示，效果前置特写，原生气口，室内自然光",
          lfDesc: "商品贴近镜头，卖点卖点字样字幕位",
          motionDesc: "快速推近",
          audioDesc: "钩子口播：还在为___烦恼？用它 3 秒搞定",
          variationType: "large",
        },
        label: "①钩子镜头（0-3s）",
      },
      {
        id: "shot-solution",
        type: "shot",
        position: { x: 640, y: 0 },
        data: {
          ffDesc: "模特手持商品使用中，中景，产品 logo 朝向镜头",
          lfDesc: "使用后效果展示，特写",
          motionDesc: "固定",
          audioDesc: "方案口播：它___（卖点1），___（卖点2），实测___",
          variationType: "medium",
        },
        label: "②方案镜头（3-11s）",
      },
      {
        id: "shot-cta",
        type: "shot",
        position: { x: 960, y: 0 },
        data: {
          ffDesc: "商品+价格字幕居中构图，画面主体居中避开平台 UI 遮挡区",
          lfDesc: "",
          motionDesc: "轻微推近",
          audioDesc: "CTA 口播：同款链接就在下方，直接拍",
          variationType: "small",
        },
        label: "③CTA镜头（11-15s）",
      },
    ],
    edges: [
      { id: "e0", source: "product", target: "shot-hook", targetHandle: "reference" },
      { id: "e1", source: "script", target: "shot-hook" },
      { id: "e2", source: "script", target: "shot-solution" },
      { id: "e3", source: "script", target: "shot-cta" },
    ],
  },
  {
    id: "ad-feature-demo",
    name: "广告·30秒 功能演示（9:16）",
    description: "痛点场景→功能特写→使用演示→CTA，适合 3C/家电/工具类，一键全自动出片",
    category: "ad",
    nodes: [
      {
        id: "script",
        type: "script",
        position: { x: 0, y: 0 },
        data: {
          content: [
            "【30秒 功能演示广告脚本】",
            "产品：请替换为你的商品（一句话：品类 + 核心功能）",
            "",
            "【钩子 0-3秒】痛点提问：___是不是特别麻烦？",
            "【痛点 3-8秒】放大传统方式的麻烦与代价",
            "【方案 8-24秒】功能演示：开机→操作→结果，卖点逐个落地",
            "【CTA 24-30秒】限时优惠指令",
          ].join("\n"),
          status: "idle",
          isAd: true,
        },
        label: "广告脚本（替换商品与口播）",
      },
      {
        id: "product",
        type: "image",
        position: { x: 0, y: 240 },
        data: {
          prompt: "商品功能特写，操作界面清晰，信息流广告质感",
          size: "864x1536",
          kind: "product",
          aspectRatio: "fv-9-16",
        },
        label: "商品图（可上传替换）",
      },
      {
        id: "shot-pain",
        type: "shot",
        position: { x: 320, y: 0 },
        data: {
          ffDesc: "用户被问题困扰的真实场景，近景，情绪可见",
          lfDesc: "",
          motionDesc: "手持",
          audioDesc: "痛点口播：每次___都要折腾半天？",
          variationType: "large",
        },
        label: "①痛点镜头（0-8s）",
      },
      {
        id: "shot-feature",
        type: "shot",
        position: { x: 640, y: 0 },
        data: {
          ffDesc: "商品功能操作特写，手指按下的瞬间，界面清晰",
          lfDesc: "功能生效的结果画面",
          motionDesc: "固定",
          audioDesc: "方案口播：只要一步，它就能___",
          variationType: "medium",
        },
        label: "②功能特写（8-16s）",
      },
      {
        id: "shot-demo",
        type: "shot",
        position: { x: 960, y: 0 },
        data: {
          ffDesc: "完整使用流程演示，中景，产品在画面中心",
          lfDesc: "完成后的成果展示",
          motionDesc: "跟拍",
          audioDesc: "演示口播：从___到___，只要___分钟",
          variationType: "medium",
        },
        label: "③使用演示（16-24s）",
      },
      {
        id: "shot-cta",
        type: "shot",
        position: { x: 1280, y: 0 },
        data: {
          ffDesc: "商品+优惠信息居中构图，主体居中避开平台 UI 遮挡区",
          lfDesc: "",
          motionDesc: "轻微推近",
          audioDesc: "CTA 口播：今天下单立减___，点下方链接",
          variationType: "small",
        },
        label: "④CTA镜头（24-30s）",
      },
    ],
    edges: [
      { id: "e0", source: "product", target: "shot-pain", targetHandle: "reference" },
      { id: "e1", source: "script", target: "shot-pain" },
      { id: "e2", source: "script", target: "shot-feature" },
      { id: "e3", source: "script", target: "shot-demo" },
      { id: "e4", source: "script", target: "shot-cta" },
    ],
  },
  {
    id: "ad-comparison",
    name: "广告·痛点对比种草（9:16）",
    description: "before/after 前后对比→用户见证→CTA，适合美妆/家居/个护种草，一键全自动出片",
    category: "ad",
    nodes: [
      {
        id: "script",
        type: "script",
        position: { x: 0, y: 0 },
        data: {
          content: [
            "【30秒 前后对比种草脚本】",
            "产品：请替换为你的商品（一句话：品类 + 改变什么）",
            "",
            "【钩子 0-3秒】效果前置：直接甩出 after 画面",
            "【对比 3-15秒】before（糟糕状态）→ after（使用后状态）",
            "【见证 15-25秒】用户证言 / 数据背书",
            "【CTA 25-30秒】点击了解同款",
          ].join("\n"),
          status: "idle",
          isAd: true,
        },
        label: "广告脚本（替换商品与口播）",
      },
      {
        id: "product",
        type: "image",
        position: { x: 0, y: 240 },
        data: {
          prompt: "商品手持特写，使用场景，种草笔记质感",
          size: "864x1536",
          kind: "product",
          aspectRatio: "fv-9-16",
        },
        label: "商品图（可上传替换）",
      },
      {
        id: "shot-before",
        type: "shot",
        position: { x: 320, y: 0 },
        data: {
          ffDesc: "使用前的糟糕状态特写，冷色调，情绪低",
          lfDesc: "",
          motionDesc: "固定",
          audioDesc: "钩子口播：以前的我真的不敢出门",
          variationType: "large",
        },
        label: "①Before（0-8s）",
      },
      {
        id: "shot-after",
        type: "shot",
        position: { x: 640, y: 0 },
        data: {
          ffDesc: "使用后的状态特写，暖色调，自信状态，商品入画",
          lfDesc: "",
          motionDesc: "缓慢拉远",
          audioDesc: "对比口播：用了它之后，同事都问我是不是换了个头",
          variationType: "large",
        },
        label: "②After（8-15s）",
      },
      {
        id: "shot-proof-cta",
        type: "shot",
        position: { x: 960, y: 0 },
        data: {
          ffDesc: "用户面对镜头口播见证，中景，商品举在胸前",
          lfDesc: "商品+销量字幕居中构图，避开平台 UI 遮挡区",
          motionDesc: "固定",
          audioDesc: "见证+CTA 口播：已经回购 3 次了，同款在下方链接",
          variationType: "medium",
        },
        label: "③见证+CTA（15-30s）",
      },
    ],
    edges: [
      { id: "e0", source: "product", target: "shot-before", targetHandle: "reference" },
      { id: "e1", source: "script", target: "shot-before" },
      { id: "e2", source: "script", target: "shot-after" },
      { id: "e3", source: "script", target: "shot-proof-cta" },
    ],
  },
];

export function getTemplateById(id: string): WorkflowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find((t) => t.id === id);
}

// ── Instantiation (pure) ───────────────────────────────────────────

export interface InstantiateOptions {
  /** Override the id generator (deterministic ids for tests). */
  idGenerator?: () => string;
  /** Translate every node position by this offset. */
  offset?: { x: number; y: number };
}

/**
 * Clone a template into a concrete set of canvas nodes + edges with fresh
 * ids. Edges are rewired from template-local ids to the new node ids.
 * Node `data` is shallow-cloned per node (the template is never mutated).
 */
export function instantiateTemplate(
  template: WorkflowTemplate,
  opts: InstantiateOptions = {},
): { nodes: InstantiatedNode[]; edges: InstantiatedEdge[] } {
  const gen = opts.idGenerator ?? randomUUID;
  const offset = opts.offset ?? { x: 0, y: 0 };

  const idMap = new Map<string, string>();
  const nodes: InstantiatedNode[] = template.nodes.map((n) => {
    const newId = gen();
    idMap.set(n.id, newId);
    return {
      id: newId,
      type: n.type,
      position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
      data: { ...n.data },
    };
  });

  const edges: InstantiatedEdge[] = template.edges.map((e) => ({
    id: gen(),
    source: idMap.get(e.source) ?? e.source,
    target: idMap.get(e.target) ?? e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
  }));

  return { nodes, edges };
}
