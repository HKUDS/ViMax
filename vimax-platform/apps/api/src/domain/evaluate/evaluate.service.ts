import type { ComplianceReport, ImageEvaluation } from "@vimax/contracts";
import { and, eq } from "drizzle-orm";
import { generateText, type AIMessage } from "../agent/ai-service.js";
import { getDb } from "../../infrastructure/db/client.js";
import { assets, canvasNodes } from "../../infrastructure/db/schema.js";
import { getObjectBuffer } from "../../infrastructure/storage/s3.js";
import { updateNodeDataField } from "../canvas/canvas.service.js";
import { runNode } from "../canvas/node-executor.service.js";

export const EVALUATE_WEIGHTS = { fidelity: 0.4, text: 0.2, aesthetics: 0.2, compliance: 0.2 } as const;

export type EvaluateDimensions = {
  fidelity: number;
  text: number;
  aesthetics: number;
  compliance: number;
};

export function weightedOverall(dimensions: EvaluateDimensions): number {
  const overall =
    dimensions.fidelity * EVALUATE_WEIGHTS.fidelity +
    dimensions.text * EVALUATE_WEIGHTS.text +
    dimensions.aesthetics * EVALUATE_WEIGHTS.aesthetics +
    dimensions.compliance * EVALUATE_WEIGHTS.compliance;
  return Number(overall.toFixed(3));
}

export function shouldAutoRefine(input: {
  evaluation: ImageEvaluation;
  attempt: number;
}): { refine: boolean; reason?: string } {
  if (input.evaluation.overall >= 0.6) return { refine: false, reason: "overall >= 0.6" };
  if (input.attempt >= 1) return { refine: false, reason: "refine attempt budget exhausted" };
  return { refine: true, reason: "overall < 0.6" };
}

export function buildRefinePrompt(originalPrompt: string, critique: string): string {
  return `${originalPrompt}\n\n改进要求：${critique}；保持商品主体与构图不变`;
}

const JUDGE_SYSTEM = "你是电商生成图的严格质量评审，只输出 JSON，不输出任何多余文字。";

function buildJudgeMessages(imageDataUrl: string): AIMessage[] {
  return [
    { role: "system", content: JUDGE_SYSTEM },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: '请为这张生成图打分（各维度 0-1）：fidelity（与提示词的符合度）、text（图中文字的正确性与可读性，无文字给 0.8）、aesthetics（美学质量）。输出 JSON：{"fidelity": 0.8, "text": 0.8, "aesthetics": 0.8, "critique": "一句话中文点评"}',
        },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function parseJudgeScores(text: string): { fidelity: number; text: number; aesthetics: number; critique: string } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenced?.[1] ?? text;
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("judge: no JSON object in response");
  const parsed = JSON.parse(jsonText.slice(start, end + 1)) as Record<string, unknown>;
  const score = (key: string): number => {
    const value = parsed[key];
    if (typeof value !== "number" || Number.isNaN(value)) {
      throw new Error(`judge: missing score "${key}"`);
    }
    return clamp01(value);
  };
  return {
    fidelity: score("fidelity"),
    text: score("text"),
    aesthetics: score("aesthetics"),
    critique: typeof parsed.critique === "string" ? parsed.critique : "",
  };
}

function neutralEvaluation(reason: string): ImageEvaluation {
  const dimensions: EvaluateDimensions = { fidelity: 0.5, text: 0.5, aesthetics: 0.5, compliance: 0.5 };
  return { overall: weightedOverall(dimensions), dimensions, critique: reason };
}

async function loadImageDataUrl(assetId: string): Promise<string> {
  const db = getDb();
  const [asset] = await db
    .select({ storageKey: assets.storageKey, mimeType: assets.mimeType })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!asset) throw new Error(`evaluate: asset ${assetId} not found`);
  const buffer = await getObjectBuffer(asset.storageKey);
  return `data:${asset.mimeType};base64,${buffer.toString("base64")}`;
}

async function complianceDimension(canvasId: string, nodeId: string): Promise<number> {
  const db = getDb();
  const [node] = await db
    .select({ data: canvasNodes.data })
    .from(canvasNodes)
    .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
    .limit(1);
  const data = (node?.data as Record<string, unknown> | undefined) ?? {};
  if (!Array.isArray(data.complianceReports) || data.complianceReports.length === 0) return 0.5;
  const reports = data.complianceReports as ComplianceReport[];
  return reports.filter((report) => report.passed).length / reports.length;
}

export async function evaluateImage(input: {
  canvasId: string;
  nodeId: string;
  assetId: string;
  jobId: string;
}): Promise<ImageEvaluation> {
  const imageDataUrl = await loadImageDataUrl(input.assetId);
  const compliance = await complianceDimension(input.canvasId, input.nodeId);

  let evaluation: ImageEvaluation;
  try {
    const response = await generateText({
      messages: buildJudgeMessages(imageDataUrl),
      temperature: 0.2,
      maxTokens: 1024,
    });
    const scores = parseJudgeScores(response.text);
    const dimensions: EvaluateDimensions = {
      fidelity: scores.fidelity,
      text: scores.text,
      aesthetics: scores.aesthetics,
      compliance,
    };
    evaluation = {
      overall: weightedOverall(dimensions),
      dimensions,
      critique: scores.critique,
    };
  } catch (err) {
    evaluation = neutralEvaluation(err instanceof Error ? err.message : "judge failed");
  }

  await updateNodeDataField(input.canvasId, input.nodeId, "evaluation", evaluation);
  return evaluation;
}

export async function maybeEvaluateNode(
  canvasId: string,
  nodeId: string,
  jobId: string,
  assetId: string,
): Promise<void> {
  try {
    const db = getDb();
    const [node] = await db
      .select({ data: canvasNodes.data })
      .from(canvasNodes)
      .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.id, nodeId)))
      .limit(1);
    const data = (node?.data as Record<string, unknown> | undefined) ?? {};
    const attempt = typeof data.evaluateAttempt === "number" ? data.evaluateAttempt : 0;

    const evaluation = await evaluateImage({ canvasId, nodeId, assetId, jobId });
    if (!shouldAutoRefine({ evaluation, attempt }).refine) return;

    await updateNodeDataField(canvasId, nodeId, "evaluateAttempt", attempt + 1);
    const prompt = typeof data.prompt === "string" ? data.prompt : "";
    await updateNodeDataField(canvasId, nodeId, "prompt", buildRefinePrompt(prompt, evaluation.critique ?? ""));
    await runNode({ canvas_id: canvasId, node_id: nodeId });
  } catch (err) {
    console.error(`[evaluate] node ${nodeId}:`, err instanceof Error ? err.message : err);
  }
}
