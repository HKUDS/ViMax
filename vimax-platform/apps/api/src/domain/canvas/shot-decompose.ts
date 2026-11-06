// ── Storyboard cell → Shot decomposition (分镜格 → 镜头) ────────────
//
// Mirrors idea2video's `StoryboardArtist.decompose_visual_description`
// (agents/storyboard_artist.py): expand a single storyboard cell's brief into
// the structured fields a shot node needs — first/last frame descriptions,
// the motion connecting them, and a variation type. Everything here is pure
// so the LLM round-trip is the only part that can't be unit-tested.

import type { ShotNodeData } from "@vimax/contracts";
import type { ShotVariationType } from "./canvas-graph.js";

export interface ShotDecomposition {
  ffDesc: string;
  lfDesc: string;
  motionDesc: string;
  audioDesc?: string;
  variationType?: ShotVariationType;
}

const VALID_VARIATION_TYPES: readonly ShotVariationType[] = ["large", "medium", "small"];

/** Coerce an unknown value into a valid variation type, defaulting to medium. */
export function normalizeVariationType(value: unknown): ShotVariationType {
  return VALID_VARIATION_TYPES.includes(value as ShotVariationType)
    ? (value as ShotVariationType)
    : "medium";
}

/** Map a parsed decomposition into a complete ShotNodeData with safe fallbacks. */
export function buildShotNodeData(decomp: Partial<ShotDecomposition>): ShotNodeData {
  return {
    ffDesc: (decomp.ffDesc ?? "").trim(),
    lfDesc: (decomp.lfDesc ?? "").trim(),
    motionDesc: (decomp.motionDesc ?? "").trim(),
    audioDesc: (decomp.audioDesc ?? "").trim(),
    variationType: normalizeVariationType(decomp.variationType),
    ffVisCharIdxs: [],
    lfVisCharIdxs: [],
  };
}

// ── Prompt construction ────────────────────────────────────────────

export const STORYBOARD_DECOMPOSE_SYSTEM_PROMPT = `你是一位专业的视觉分析师，精通电影语言与镜头叙事。你的任务是把一个镜头的简短分镜描述，精确拆解为三个部分：静态首帧、静态末帧、连接二者的运动描述。

要求：
- 首帧/末帧描述必须是纯粹的"静态画面快照"，不得包含正在进行的动作（如"正要站起"应写成"坐在椅上，身体微倾"）。
- 运动描述需区分摄影机运动（推/拉/摇/移/跟/升降）与画面内元素的运动；用人物的外貌特征指代人物，不得直接使用角色名。
- variation_type 表示首末帧之间的变化程度：large=构图剧变或夸张过渡（如航拍穿越城市），medium=引入新角色或人物由背转正，small=表情/姿势等细微变化或温和的运镜。
- 只输出一个 JSON 对象，不要任何其他文字。

输出格式：
{"ff_desc": "首帧静态描述", "lf_desc": "末帧静态描述", "motion_desc": "运动描述", "variation_type": "large|medium|small"}`;

export function buildDecomposeUserPrompt(shotBrief: string, audioDesc?: string): string {
  const audio = audioDesc?.trim();
  const audioLine = audio ? `\n音频/台词参考: ${audio}` : "";
  return `<分镜描述>\n${shotBrief.trim()}${audioLine}\n</分镜描述>`;
}

// ── Response parsing ───────────────────────────────────────────────

/**
 * Parse the JSON object embedded in the model's free-form text response into
 * a decomposition. Returns null when no JSON object can be recovered.
 */
export function parseDecomposition(text: string): ShotDecomposition | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>;
    return {
      ffDesc: typeof raw.ff_desc === "string" ? raw.ff_desc : "",
      lfDesc: typeof raw.lf_desc === "string" ? raw.lf_desc : "",
      motionDesc: typeof raw.motion_desc === "string" ? raw.motion_desc : "",
      audioDesc: typeof raw.audio_desc === "string" ? raw.audio_desc : undefined,
      variationType: normalizeVariationType(raw.variation_type),
    };
  } catch {
    return null;
  }
}
