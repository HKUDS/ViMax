// ── Agent Memory Service ─────────────────────────────────────────────
// Adapted from Toonflow's utils/agent/memory.ts — three-tier retrieval:
// 1. Short-term: Recent unsummarized messages
// 2. Summaries: AI-compressed conversation summaries
// 3. RAG: Vector similarity search (JSONB-based, no pgvector required)
//
// Uses JSONB to store embedding vectors as float arrays, with cosine
// similarity computed in TypeScript. This avoids the pgvector extension.

import { getDb } from "../../infrastructure/db/client.js";
import {
  agentConversations,
  agentMemorySummaries,
  agentMessages,
  userMemoryProfile,
} from "../../infrastructure/db/schema.js";
import { asc, eq, sql } from "drizzle-orm";
import { generateText } from "../agent/ai-service.js";

// ── Database Schema (added to schema.ts) ─────────────────────────────
// These tables are created via drizzle-kit push when schema.ts is updated.

// ── Memory Config ────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  messagesPerSummary: 3,    // Trigger summary after N unsummarized messages
  summaryMaxLength: 500,    // Max chars per summary
  shortTermLimit: 5,        // Recent unsummarized messages
  summaryLimit: 10,         // Summaries to return
  ragLimit: 3,              // Vector search results
};

// ── Types ────────────────────────────────────────────────────────────

export interface MemoryMessage {
  id: string;
  canvasId: string;
  agentType: string;
  role: "user" | "assistant" | "system";
  content: string;
  embedding: number[] | null;
  summarized: boolean;
  createdAt: Date;
}

export interface MemorySummary {
  id: string;
  canvasId: string;
  agentType: string;
  summary: string;
  messageIds: string[];
  embedding: number[] | null;
  createdAt: Date;
}

export interface MemoryRetrievalResult {
  shortTerm: Array<{ role: string; content: string }>;
  summaries: Array<{ summary: string }>;
  rag: Array<{ role: string; content: string; similarity: number }>;
}

// ── Memory Service ───────────────────────────────────────────────────

export class MemoryService {
  private canvasId: string;
  private agentType: string;

  constructor(canvasId: string, agentType: string) {
    this.canvasId = canvasId;
    this.agentType = agentType;
  }

  /**
   * Store a message in memory with optional embedding.
   */
  async add(
    role: "user" | "assistant" | "system",
    content: string,
    embedding?: number[],
  ): Promise<string> {
    const db = getDb();
    const id = crypto.randomUUID();

    await db.execute(sql`
      INSERT INTO agent_memory_messages (id, canvas_id, agent_type, role, content, embedding, summarized)
      VALUES (${id}, ${this.canvasId}, ${this.agentType}, ${role}, ${content}, ${embedding ? JSON.stringify(embedding) : null}, false)
    `);

    // Check if we should trigger summarization
    await this.checkAndSummarize();

    return id;
  }

  /**
   * Three-tier memory retrieval for building agent context.
   */
  async retrieve(query: string, queryEmbedding?: number[]): Promise<MemoryRetrievalResult> {
    const config = DEFAULT_CONFIG;

    // 1. Short-term: Recent unsummarized messages
    const shortTerm = await this.getShortTerm(config.shortTermLimit);

    // 2. Summaries: Recent conversation summaries
    const summaries = await this.getSummaries(config.summaryLimit);

    // 3. RAG: Vector similarity search (if embedding available)
    let rag: Array<{ role: string; content: string; similarity: number }> = [];
    if (queryEmbedding) {
      rag = await this.vectorSearch(queryEmbedding, config.ragLimit);
    }

    return { shortTerm, summaries, rag };
  }

  /**
   * Build a structured prompt from memory for injection into agent context.
   */
  async buildMemoryPrompt(query: string, queryEmbedding?: number[]): Promise<string> {
    const retrieval = await this.retrieve(query, queryEmbedding);
    const parts: string[] = [];

    if (retrieval.rag.length > 0) {
      parts.push("## 相关记忆");
      parts.push(
        ...retrieval.rag.map(
          (r) => `[${r.role}] ${r.content.slice(0, 200)} (相似度: ${r.similarity.toFixed(2)})`,
        ),
      );
    }

    if (retrieval.summaries.length > 0) {
      parts.push("## 历史摘要");
      parts.push(...retrieval.summaries.map((s) => s.summary));
    }

    if (retrieval.shortTerm.length > 0) {
      parts.push("## 近期对话");
      parts.push(
        ...retrieval.shortTerm.map((m) => `[${m.role}] ${m.content.slice(0, 300)}`),
      );
    }

    return parts.length > 0 ? parts.join("\n\n") : "";
  }

  // ── Private methods ──────────────────────────────────────────────

  private async getShortTerm(limit: number): Promise<Array<{ role: string; content: string }>> {
    const db = getDb();
    const result = await db.execute(sql`
      SELECT role, content
      FROM agent_memory_messages
      WHERE canvas_id = ${this.canvasId}
        AND agent_type = ${this.agentType}
        AND summarized = false
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const rows = Array.isArray(result) ? result : [...(result as unknown as Iterable<Record<string, unknown>>)];
    return rows.reverse().map((r: Record<string, unknown>) => ({
      role: r.role as string,
      content: r.content as string,
    }));
  }

  private async getSummaries(limit: number): Promise<Array<{ summary: string }>> {
    const db = getDb();
    const result = await db.execute(sql`
      SELECT summary
      FROM agent_memory_summaries
      WHERE canvas_id = ${this.canvasId}
        AND agent_type = ${this.agentType}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    const rows = [...(result as unknown as Iterable<Record<string, unknown>>)];
    return rows.reverse().map((r) => ({
      summary: r.summary as string,
    }));
  }

  private async vectorSearch(
    queryEmbedding: number[],
    limit: number,
  ): Promise<Array<{ role: string; content: string; similarity: number }>> {
    const db = getDb();

    // Get all messages with embeddings for this canvas/agent
    const result = await db.execute(sql`
      SELECT id, role, content, embedding
      FROM agent_memory_messages
      WHERE canvas_id = ${this.canvasId}
        AND agent_type = ${this.agentType}
        AND embedding IS NOT NULL
    `);
    const rows = [...(result as unknown as Iterable<Record<string, unknown>>)];

    // Compute cosine similarity in TypeScript
    const scored = rows
      .map((r: Record<string, unknown>) => {
        const embedding = JSON.parse((r.embedding as string) ?? "[]");
        if (!Array.isArray(embedding) || embedding.length === 0) return null;
        const similarity = cosineSimilarity(queryEmbedding, embedding);
        return {
          role: r.role as string,
          content: r.content as string,
          similarity,
        };
      })
      .filter(Boolean) as Array<{ role: string; content: string; similarity: number }>;

    // Sort by similarity descending, take top K
    return scored
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  private async checkAndSummarize(): Promise<void> {
    const config = DEFAULT_CONFIG;
    const db = getDb();

    // Count unsummarized messages
    const countResult = await db.execute(sql`
      SELECT COUNT(*) as cnt
      FROM agent_memory_messages
      WHERE canvas_id = ${this.canvasId}
        AND agent_type = ${this.agentType}
        AND summarized = false
    `);
    const countRows = [...(countResult as unknown as Iterable<Record<string, unknown>>)];

    const count = Number(countRows[0]?.cnt ?? 0);
    if (count < config.messagesPerSummary) return;

    // Get the oldest unsummarized batch
    const batchResult = await db.execute(sql`
      SELECT id, role, content
      FROM agent_memory_messages
      WHERE canvas_id = ${this.canvasId}
        AND agent_type = ${this.agentType}
        AND summarized = false
      ORDER BY created_at ASC
      LIMIT ${config.messagesPerSummary}
    `);
    const batch = [...(batchResult as unknown as Iterable<Record<string, unknown>>)];

    if (batch.length === 0) return;

    // Create a simple summary by concatenating and truncating
    // (In production, this would call an LLM to compress)
    const ids = batch.map((r: Record<string, unknown>) => r.id as string);
    const contents = batch.map(
      (r: Record<string, unknown>) => `[${r.role}] ${(r.content as string).slice(0, 100)}`,
    );
    const summaryText = contents.join(" | ").slice(0, config.summaryMaxLength);

    // Store summary
    await db.execute(sql`
      INSERT INTO agent_memory_summaries (id, canvas_id, agent_type, summary, message_ids)
      VALUES (${crypto.randomUUID()}, ${this.canvasId}, ${this.agentType}, ${summaryText}, ${JSON.stringify(ids)})
    `);

    // Mark messages as summarized
    for (const id of ids) {
      await db.execute(sql`
        UPDATE agent_memory_messages SET summarized = true WHERE id = ${id}
      `);
    }
  }
}

// ── Utility: Cosine Similarity ──────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── User Memory Profile (long-term facts, P2) ────────────────────────

export interface ProfileFact {
  key: string;
  value: string;
  confidence?: number;
  updatedAt: string;
}

/** Merge profile facts by key — incoming overrides existing, untouched
 * facts keep their original updatedAt. Pure. */
export function mergeProfileFacts(
  existing: ProfileFact[],
  incoming: ProfileFact[],
): ProfileFact[] {
  const byKey = new Map<string, ProfileFact>();
  for (const fact of existing) byKey.set(fact.key, fact);
  for (const fact of incoming) {
    byKey.set(fact.key, { ...fact, updatedAt: new Date().toISOString() });
  }
  return [...byKey.values()];
}

async function saveProfileFacts(userId: string, incoming: ProfileFact[]): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ profile: userMemoryProfile.profile })
    .from(userMemoryProfile)
    .where(eq(userMemoryProfile.userId, userId))
    .limit(1);
  const current = (row?.profile as { facts?: ProfileFact[] } | null) ?? {};
  const profile = { ...current, facts: mergeProfileFacts(current.facts ?? [], incoming) };
  if (row) {
    await db
      .update(userMemoryProfile)
      .set({ profile })
      .where(eq(userMemoryProfile.userId, userId));
  } else {
    await db.insert(userMemoryProfile).values({ userId, profile });
  }
}

export async function rememberFact(
  userId: string,
  key: string,
  value: string,
): Promise<void> {
  await saveProfileFacts(userId, [{ key, value, updatedAt: new Date().toISOString() }]);
}

/** Render the user's profile facts as a system-prompt fragment; ""
 * when the profile is empty. */
export async function getMemoryContext(userId: string): Promise<string> {
  const db = getDb();
  const [row] = await db
    .select({ profile: userMemoryProfile.profile })
    .from(userMemoryProfile)
    .where(eq(userMemoryProfile.userId, userId))
    .limit(1);
  const facts = ((row?.profile as { facts?: ProfileFact[] } | null) ?? {}).facts ?? [];
  if (facts.length === 0) return "";
  return `## 用户记忆\n${facts.map((f) => `- ${f.key}: ${f.value}`).join("\n")}`;
}

const SUMMARY_SYSTEM_PROMPT =
  "把以下对话压缩为一段不超过 200 字的中文摘要，保留关键决策与结论，只输出摘要正文。";

export async function summarizeConversation(
  conversationId: string,
): Promise<string | null> {
  const db = getDb();
  const [conversation] = await db
    .select({ canvasId: agentConversations.canvasId })
    .from(agentConversations)
    .where(eq(agentConversations.id, conversationId))
    .limit(1);
  const messages = await db
    .select({ id: agentMessages.id, role: agentMessages.role, content: agentMessages.content })
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId))
    .orderBy(asc(agentMessages.createdAt));
  if (messages.length === 0) return null;

  const transcript = messages
    .map((m) => `[${m.role}] ${m.content.slice(0, 300)}`)
    .join("\n");
  const result = await generateText({
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: transcript,
    temperature: 0.3,
    maxTokens: 500,
  });
  const summary = result.text.trim().slice(0, 200);
  if (!summary) return null;

  await db.insert(agentMemorySummaries).values({
    canvasId: conversation!.canvasId,
    agentType: "production",
    summary,
    messageIds: messages.map((m) => String(m.id)),
  });
  return summary;
}

const PROFILE_SIGNAL_SYSTEM_PROMPT =
  '从对话中提取关于用户的长期事实（偏好、行业、商品类目、风格要求等）。' +
  '只输出 JSON：{"facts":[{"key":"事实名","value":"内容"}]}，没有可提取的事实时输出 {"facts":[]}。';

/** Models wrap JSON in code fences or prose — pull out the outermost object. */
function parseJsonArgument(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no json object in output");
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

export async function extractProfileSignals(
  userId: string,
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  if (messages.length === 0) return;
  const transcript = messages
    .map((m) => `[${m.role}] ${m.content.slice(0, 500)}`)
    .join("\n");
  const result = await generateText({
    system: PROFILE_SIGNAL_SYSTEM_PROMPT,
    prompt: transcript,
    temperature: 0,
  });
  try {
    const parsed = parseJsonArgument(result.text) as {
      facts?: Array<{ key?: unknown; value?: unknown }>;
    };
    const incoming = (parsed.facts ?? [])
      .filter(
        (f): f is { key: string; value: string } =>
          typeof f.key === "string" &&
          f.key.trim() !== "" &&
          typeof f.value === "string" &&
          f.value.trim() !== "",
      )
      .map((f) => ({
        key: f.key.trim(),
        value: f.value.trim(),
        updatedAt: new Date().toISOString(),
      }));
    if (incoming.length === 0) return;
    await saveProfileFacts(userId, incoming);
  } catch {
    // 模型输出非 JSON — 静默跳过本轮画像提取
  }
}
