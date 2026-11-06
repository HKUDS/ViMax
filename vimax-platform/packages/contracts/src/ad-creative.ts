// ── Ad creative presets & script structure (广告创意) ────────────────
// 单一来源：广告时长/hook/CTA 词条 + 直效（DR）脚本结构与 prompt 组装。
// 方法论依据见 docs/specs/AD-CREATIVE-RESEARCH.md：
// 黄金3秒（滚动决策约 1.5s）、DR 公式（Hook→Pain→Solution→Proof→CTA）、
// 15s 收缩为 Hook→Solution→CTA、一条广告一个信息一个动作。

// ── 时长预设 ────────────────────────────────────────────────────────

export type AdBeatId = "hook" | "pain" | "solution" | "proof" | "cta";

export interface AdDurationPreset {
  id: "15s" | "30s" | "60s";
  label: string;
  durationSec: number;
  /** 该时长采用的节拍（DR 公式按时长收缩）。 */
  beats: readonly AdBeatId[];
  hint: string;
}

export const AD_DURATION_PRESETS: readonly AdDurationPreset[] = [
  {
    id: "15s",
    label: "15 秒 · 信息流",
    durationSec: 15,
    beats: ["hook", "solution", "cta"],
    hint: "15 秒收缩为 Hook→方案→CTA，砍掉痛点铺陈，完播率优先",
  },
  {
    id: "30s",
    label: "30 秒 · 标准",
    durationSec: 30,
    beats: ["hook", "pain", "solution", "cta"],
    hint: "完整痛点铺陈 + 方案演示，信息流主力时长",
  },
  {
    id: "60s",
    label: "60 秒 · 深度种草",
    durationSec: 60,
    beats: ["hook", "pain", "solution", "proof", "cta"],
    hint: "加信任背书（见证/数据/成分），适合高客单价",
  },
];

export function getAdDurationPreset(durationSec: number): AdDurationPreset {
  return AD_DURATION_PRESETS.find((p) => p.durationSec === durationSec) ?? AD_DURATION_PRESETS[1];
}

// ── Hook 类型（黄金 3 秒）────────────────────────────────────────────

export type AdHookTypeId =
  | "pain_question"
  | "counter_intuition"
  | "result_first"
  | "identity"
  | "suspense";

export interface AdHookType {
  id: AdHookTypeId;
  label: string;
  /** 中文句式模板（生成 prompt 与 UI 词条共用）。 */
  template: string;
  hint: string;
}

export const AD_HOOK_TYPES: readonly AdHookType[] = [
  {
    id: "pain_question",
    label: "痛点提问",
    template: "还在为___烦恼？/ ___不敢___怎么办？",
    hint: "直击目标人群的具体焦虑，痛点越具体越准",
  },
  {
    id: "counter_intuition",
    label: "反常识",
    template: "别再___了，其实___才是真相",
    hint: "制造认知差，适合教育型品类",
  },
  {
    id: "result_first",
    label: "效果前置",
    template: "前 3 秒直接展示使用后的结果/获得感",
    hint: "美妆、改造类首选",
  },
  {
    id: "identity",
    label: "身份认同",
    template: "如果你也是___，这条视频别划走",
    hint: "人群精准的投放",
  },
  {
    id: "suspense",
    label: "悬念冲突",
    template: "用最炸裂的冲突/颠覆性画面开场",
    hint: "短剧带货",
  },
];

export function getAdHookType(id: string | undefined): AdHookType {
  return AD_HOOK_TYPES.find((h) => h.id === id) ?? AD_HOOK_TYPES[0];
}

// ── CTA 类型（与钩子呼应）────────────────────────────────────────────

export type AdCtaTypeId = "limited_offer" | "buy_now" | "learn_more" | "follow";

export interface AdCtaType {
  id: AdCtaTypeId;
  label: string;
  /** 示例文案。 */
  template: string;
  /** 与 hook 类型的呼应关系。 */
  pairsWith: string;
}

export const AD_CTA_TYPES: readonly AdCtaType[] = [
  {
    id: "limited_offer",
    label: "限时优惠",
    template: "今天下单立减___，点下方链接",
    pairsWith: "放大紧迫感，配合痛点/焦虑型钩子",
  },
  {
    id: "buy_now",
    label: "立即购买",
    template: "同款链接就在下方，直接拍",
    pairsWith: "配合效果前置钩子",
  },
  {
    id: "learn_more",
    label: "点击了解",
    template: "点击下方链接，领取解决方案",
    pairsWith: "呼应痛点提问型钩子",
  },
  {
    id: "follow",
    label: "关注账号",
    template: "关注我，下期拆解___",
    pairsWith: "内容型/种草型广告",
  },
];

export function getAdCtaType(id: string | undefined): AdCtaType {
  return AD_CTA_TYPES.find((c) => c.id === id) ?? AD_CTA_TYPES[0];
}

// ── 广告脚本结构 ────────────────────────────────────────────────────

export interface AdScriptBeat {
  beat: AdBeatId;
  startSec: number;
  endSec: number;
  /** 口播/台词文案（口语化短句，约 4-5 字/秒）。 */
  voiceover: string;
  /** 镜头级画面描述：景别、主体动作、场景位置，可直接喂给分镜链。 */
  visual: string;
}

export interface AdScript {
  title: string;
  durationSec: number;
  hookType: AdHookTypeId;
  ctaType: AdCtaTypeId;
  sellingPoints: string[];
  beats: AdScriptBeat[];
}

export interface AdScriptInput {
  productDescription: string;
  sellingPoints?: string[];
  audience?: string;
  durationSec?: number;
  hookType?: AdHookTypeId;
  ctaType?: AdCtaTypeId;
  style?: string;
}

// ── Prompt 组装 ─────────────────────────────────────────────────────

const AD_SYSTEM_PROMPT = `你是一位顶级信息流广告创意总监，精通抖音/TikTok/小红书信息流广告的直效（DR）创作方法论。

创作铁律：
1. 黄金3秒：hook 必须在 3 秒内让人停下滑动（用户的滚动决策约 1.5 秒内发生）
2. 一条广告只讲一个信息、只给一个行动指令
3. 15 秒广告收缩为 Hook→方案→CTA；30/60 秒才展开痛点铺陈与信任背书
4. 口播文案口语化、短句，每秒约 4-5 个字，禁止书面语
5. CTA 与钩子类型呼应（痛点钩子→"领取解决方案"；效果前置→"同款在下方"）
6. 画面描述必须是"镜头级"的：写清景别（特写/近景/中景/全景）、主体在画面中的位置与动作、场景环境，不写抽象概念
7. 商品必须真实出现在 solution 拍的画面中（产品露出）

只输出一个 JSON 对象，不要任何其他文字。`;

export function buildAdScriptPrompt(input: AdScriptInput): {
  system: string;
  prompt: string;
} {
  const durationSec = input.durationSec ?? 30;
  const preset = getAdDurationPreset(durationSec);
  const hook = getAdHookType(input.hookType);
  const cta = getAdCtaType(input.ctaType);

  const sellingPoints =
    input.sellingPoints && input.sellingPoints.length > 0
      ? input.sellingPoints.join("；")
      : "（未提供：从商品描述中自动提炼 1-3 个最有说服力的卖点）";
  const audience = input.audience?.trim() || "（未提供：根据商品描述推断最可能的人群）";
  const style = input.style?.trim() || "原生实拍感，UGC 素人口播优先于精致大片感";

  const beatSpec = preset.beats
    .map((beat) => {
      const guide: Record<AdBeatId, string> = {
        hook: `开场钩子（0-3 秒）：${hook.label}——${hook.template}。${hook.hint}`,
        pain: "痛点激化（3-8 秒）：把问题说得紧迫、情绪化，让观众对号入座",
        solution: "方案演示（中段）：产品露出 + 演示核心卖点，画面给产品特写",
        proof: "信任背书：销量数据/用户见证/成分资质，任选其一",
        cta: `行动指令（最后 3-5 秒）：${cta.label}——${cta.template}。${cta.pairsWith}`,
      };
      return `- ${beat}: ${guide[beat]}`;
    })
    .join("\n");

  const prompt = `请为以下产品创作一条 ${durationSec} 秒的信息流广告脚本。

<PRODUCT>
${input.productDescription}
</PRODUCT>

<SELLING_POINTS>
${sellingPoints}
</SELLING_POINTS>

<AUDIENCE>
${audience}
</AUDIENCE>

<CREATIVE_BRIEF>
时长：${durationSec} 秒（${preset.label}——${preset.hint}）
钩子类型：${hook.label}
CTA 类型：${cta.label}
视觉风格：${style}
</CREATIVE_BRIEF>

<BEATS>
${beatSpec}
</BEATS>

按以下 JSON 格式输出：
{
  "title": "广告标题",
  "beats": [
    { "beat": "${preset.beats[0]}", "startSec": 0, "endSec": 3, "voiceover": "口播文案", "visual": "镜头级画面描述" }
  ],
  "sellingPoints": ["本片实际使用的卖点"]
}`;

  return { system: AD_SYSTEM_PROMPT, prompt };
}

// ── 解析与格式化 ────────────────────────────────────────────────────

const VALID_BEATS: readonly AdBeatId[] = ["hook", "pain", "solution", "proof", "cta"];

function normalizeBeat(value: unknown): AdBeatId {
  return VALID_BEATS.includes(value as AdBeatId) ? (value as AdBeatId) : "solution";
}

function normalizeHookType(value: unknown): AdHookTypeId {
  return AD_HOOK_TYPES.some((h) => h.id === value) ? (value as AdHookTypeId) : "pain_question";
}

function normalizeCtaType(value: unknown): AdCtaTypeId {
  return AD_CTA_TYPES.some((c) => c.id === value) ? (value as AdCtaTypeId) : "buy_now";
}

/**
 * Parse the model's ad-script JSON. Tolerates markdown fences; returns null
 * when nothing parseable exists so callers can fall back to raw text.
 */
export function parseAdScript(text: string, durationSec = 30): AdScript | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }

  const rawBeats = Array.isArray(parsed.beats) ? parsed.beats : [];
  if (rawBeats.length === 0) return null;

  const beats: AdScriptBeat[] = rawBeats
    .map((item) => item as Record<string, unknown>)
    .map((item, index) => ({
      beat: normalizeBeat(item.beat),
      startSec: typeof item.startSec === "number" ? item.startSec : index * 5,
      endSec: typeof item.endSec === "number" ? item.endSec : index * 5 + 5,
      voiceover: typeof item.voiceover === "string" ? item.voiceover : "",
      visual: typeof item.visual === "string" ? item.visual : "",
    }))
    .filter((beat) => beat.voiceover || beat.visual);

  if (beats.length === 0) return null;

  return {
    title: typeof parsed.title === "string" ? parsed.title : "未命名广告",
    durationSec,
    hookType: normalizeHookType(parsed.hookType),
    ctaType: normalizeCtaType(parsed.ctaType),
    sellingPoints: Array.isArray(parsed.sellingPoints)
      ? parsed.sellingPoints.filter((s): s is string => typeof s === "string")
      : [],
    beats,
  };
}

/**
 * Format an ad script into storyboard-ready text (one block per beat) —
 * this becomes the script node content, directly consumable by the
 * script→storyboard chain.
 */
export function formatAdScript(ad: AdScript): string {
  const hook = getAdHookType(ad.hookType);
  const cta = getAdCtaType(ad.ctaType);
  const lines: string[] = [
    `【广告脚本】${ad.title}（${ad.durationSec} 秒 · ${hook.label}钩子 · ${cta.label}）`,
  ];
  if (ad.sellingPoints.length > 0) {
    lines.push(`【卖点】${ad.sellingPoints.join("；")}`);
  }
  lines.push("");
  for (const beat of ad.beats) {
    const beatLabel: Record<AdBeatId, string> = {
      hook: "钩子",
      pain: "痛点",
      solution: "方案",
      proof: "背书",
      cta: "行动指令",
    };
    lines.push(`【${beatLabel[beat.beat]} ${beat.startSec}-${beat.endSec}秒】`);
    if (beat.visual) lines.push(`画面：${beat.visual}`);
    if (beat.voiceover) lines.push(`口播：${beat.voiceover}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

// ── 钩子变体批量生成（投放 A/B 的标准动作）────────────────────────────

const VARIANTS_SYSTEM_PROMPT = `你是一位顶级信息流广告创意总监。用户会给你一条已有广告脚本和若干钩子类型，你要为每个钩子类型改写一版完整脚本：只换钩子策略与开场，产品、卖点、CTA 保持一致（同素材多钩子是投放 A/B 的标准做法）。

每版脚本严格遵守 DR 直效结构与黄金 3 秒法则，口播口语化短句（每秒约 4-5 字）。

只输出一个 JSON 对象，不要任何其他文字。`;

export function buildAdVariantsPrompt(
  base: AdScriptInput,
  baseScript: AdScript | null,
  hookTypes: readonly AdHookTypeId[],
): { system: string; prompt: string } {
  const durationSec = base.durationSec ?? baseScript?.durationSec ?? 30;
  const baseSummary = baseScript
    ? `已有脚本（钩子：${getAdHookType(baseScript.hookType).label}）：\n${formatAdScript(baseScript)}`
    : `产品：${base.productDescription}\n卖点：${base.sellingPoints?.join("；") ?? "自动提炼"}`;

  const prompt = `为同一个产品生成 ${hookTypes.length} 个钩子变体广告脚本，时长均为 ${durationSec} 秒。

${baseSummary}

变体钩子类型：
${hookTypes.map((id) => `- ${id}（${getAdHookType(id).label}：${getAdHookType(id).template}）`).join("\n")}

按以下 JSON 格式输出（variants 数组顺序与钩子类型顺序一致）：
{
  "variants": [
    {
      "hookType": "${hookTypes[0]}",
      "title": "变体标题",
      "beats": [
        { "beat": "hook", "startSec": 0, "endSec": 3, "voiceover": "口播", "visual": "镜头级画面描述" }
      ],
      "sellingPoints": ["卖点"]
    }
  ]
}`;
  return { system: VARIANTS_SYSTEM_PROMPT, prompt };
}

export interface AdScriptVariant extends AdScript {
  hookType: AdHookTypeId;
}

export function parseAdVariants(
  text: string,
  durationSec: number,
  expectedHookTypes: readonly AdHookTypeId[],
): AdScriptVariant[] {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return [];

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return [];
  }

  const rawVariants = Array.isArray(parsed.variants) ? parsed.variants : [];
  const variants: AdScriptVariant[] = [];
  rawVariants.forEach((item, index) => {
    const record = item as Record<string, unknown>;
    const hookType = expectedHookTypes[index] ?? normalizeHookType(record.hookType);
    const single = parseAdScript(
      JSON.stringify({ ...record, ctaType: record.ctaType ?? "buy_now" }),
      durationSec,
    );
    if (single) variants.push({ ...single, hookType });
  });
  return variants;
}

/** 从 5 类钩子里挑出与 baseHook 不同的 N 个（保持固定顺序，便于测试与 UI 稳定）。 */
export function pickVariantHookTypes(
  baseHook: AdHookTypeId,
  count: number,
  preferred?: readonly AdHookTypeId[],
): AdHookTypeId[] {
  const all = AD_HOOK_TYPES.map((h) => h.id);
  const candidates = (preferred ?? all).filter((id) => id !== baseHook);
  const unique = [...new Set(candidates)];
  return unique.slice(0, Math.max(0, count));
}

// ── 字幕（SRT 构建，供烧录与导出共用）────────────────────────────────

export interface SubtitleCue {
  startSec: number;
  endSec: number;
  text: string;
}

function formatSrtTime(totalSec: number): string {
  const ms = Math.max(0, Math.round(totalSec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)},${pad(rest, 3)}`;
}

/** 每条字幕最多两行，每行 maxLineChars 个字（信息流字幕的可读性上限）。 */
export function wrapSubtitleLine(text: string, maxLineChars = 16): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLineChars) return [clean];
  // Prefer a space near the middle (latin text); hard-break at the limit for
  // space-less CJK so neither line exceeds the readable width.
  const mid = Math.ceil(clean.length / 2);
  const spaceCut = clean.lastIndexOf(" ", mid);
  const cut = spaceCut > 0 ? spaceCut : maxLineChars;
  if (cut >= clean.length) return [clean];
  return [clean.slice(0, cut).trim(), clean.slice(cut).trim()].filter(Boolean);
}

export function buildSrt(cues: readonly SubtitleCue[]): string {
  return (
    cues
      .map((cue, index) => {
        const lines = wrapSubtitleLine(cue.text);
        return `${index + 1}\n${formatSrtTime(cue.startSec)} --> ${formatSrtTime(cue.endSec)}\n${lines.join("\n")}`;
      })
      .join("\n\n") + "\n"
  );
}

/** 广告脚本的节拍直接映射为字幕 cue（导出 SRT 用；烧录用实际片段时长）。 */
export function adScriptToCues(ad: AdScript): SubtitleCue[] {
  return ad.beats
    .filter((beat) => beat.voiceover.trim().length > 0)
    .map((beat) => ({
      startSec: beat.startSec,
      endSec: beat.endSec,
      text: beat.voiceover,
    }));
}
