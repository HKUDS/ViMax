import { eq } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import { assets } from "../../infrastructure/db/schema.js";
import { getObjectBuffer } from "../../infrastructure/storage/s3.js";
import { generateText, type AIContentPart, type AIMessage } from "../agent/ai-service.js";

export type AnalyzePurpose = "describe" | "qc" | "product_fidelity";

export interface AnalyzeResult {
  description: string;
  issues: string[];
  productFidelity?: number;
}

const SYSTEM_PROMPTS: Record<AnalyzePurpose, string> = {
  describe: "你是一名专业的图像描述专家，用中文客观描述图像内容。",
  qc: "你是一名严格的图像质检员，用中文找出图像中的瑕疵与问题。",
  product_fidelity: "你是一名商品图审核专家，用中文评估生成图对商品主体的还原程度。",
};

function purposeInstruction(purpose: AnalyzePurpose, hasReference: boolean): string {
  switch (purpose) {
    case "describe":
      return '请描述这张图片的内容、构图与风格，输出 JSON：{"description": "...", "issues": []}';
    case "qc":
      return '请质检这张图片，列出所有瑕疵（畸形、文字错误、伪影等），输出 JSON：{"description": "...", "issues": ["..."]}';
    case "product_fidelity":
      return hasReference
        ? '第一张为生成图，第二张为参考商品图。请对比两者评估商品还原度，输出 JSON：{"description": "...", "issues": ["..."], "product_fidelity": 0.87}'
        : '请评估这张图片的商品呈现质量，输出 JSON：{"description": "...", "issues": ["..."]}';
  }
}

export function buildAnalyzeMessages(
  purpose: AnalyzePurpose,
  imageDataUrl: string,
  referenceDataUrl?: string,
): AIMessage[] {
  const withReference = purpose === "product_fidelity" && referenceDataUrl !== undefined;
  const parts: AIContentPart[] = [
    { type: "text", text: purposeInstruction(purpose, withReference) },
    { type: "image_url", image_url: { url: imageDataUrl } },
  ];
  if (withReference) {
    parts.push({ type: "image_url", image_url: { url: referenceDataUrl } });
  }
  return [
    { role: "system", content: SYSTEM_PROMPTS[purpose] },
    { role: "user", content: parts },
  ];
}

export function parseAnalyzeResult(text: string): AnalyzeResult {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = fenced?.[1] ?? text;
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("analyze: no JSON object in model response");
  }
  const parsed = JSON.parse(jsonText.slice(start, end + 1)) as {
    description?: unknown;
    issues?: unknown;
    product_fidelity?: unknown;
  };
  return {
    description: typeof parsed.description === "string" ? parsed.description : "",
    issues: Array.isArray(parsed.issues)
      ? parsed.issues.filter((issue): issue is string => typeof issue === "string")
      : [],
    ...(typeof parsed.product_fidelity === "number" ? { productFidelity: parsed.product_fidelity } : {}),
  };
}

async function assetToDataUrl(assetId: string): Promise<string | null> {
  const db = getDb();
  const [asset] = await db
    .select({ storageKey: assets.storageKey, mimeType: assets.mimeType })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  if (!asset) return null;
  const buffer = await getObjectBuffer(asset.storageKey);
  return `data:${asset.mimeType};base64,${buffer.toString("base64")}`;
}

export async function analyzeAsset(
  assetId: string,
  purpose: AnalyzePurpose,
  opts?: { referenceAssetId?: string },
): Promise<AnalyzeResult> {
  const imageDataUrl = await assetToDataUrl(assetId);
  if (!imageDataUrl) throw new Error(`analyze: asset ${assetId} not found`);

  let referenceDataUrl: string | undefined;
  if (opts?.referenceAssetId) {
    referenceDataUrl = (await assetToDataUrl(opts.referenceAssetId)) ?? undefined;
  }

  const response = await generateText({
    messages: buildAnalyzeMessages(purpose, imageDataUrl, referenceDataUrl),
    temperature: 0.2,
    maxTokens: 1024,
  });
  return parseAnalyzeResult(response.text);
}
