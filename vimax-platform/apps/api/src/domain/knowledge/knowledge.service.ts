// ── Knowledge Base Service ───────────────────────────────────────────
// 双路检索：Postgres FTS + JSONB embedding 余弦（JS 侧计算，无需 pgvector），
// RRF 融合两路排名。embedding 由 AI 层生成，失败时块存 null 并降级 FTS-only。

import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../infrastructure/db/client.js";
import {
  knowledgeChunks,
  knowledgeDocuments,
} from "../../infrastructure/db/schema.js";
import { generateEmbedding } from "../agent/ai-service.js";
import { PLATFORM_RULES } from "./platform-rules.js";

// ── Chunking (pure) ──────────────────────────────────────────────────

/** Sliding-window chunking with overlap; consecutive chunks share `overlap`
 * chars so no content is dropped at window boundaries. */
export function chunkText(content: string, size = 500, overlap = 50): string[] {
  const text = content.trim();
  if (!text) return [];
  if (text.length <= size) return [text];
  const step = Math.max(size - overlap, 1);
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += step) {
    chunks.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }
  return chunks;
}

// ── RRF fusion (pure) ────────────────────────────────────────────────

/** Reciprocal Rank Fusion: score = Σ 1/(k + rank), rank is 1-based. */
export function rrfFuse(
  rankings: Array<Array<{ id: string }>>,
  k = 60,
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((item, idx) => {
      scores.set(item.id, (scores.get(item.id) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

// ── Ingest ───────────────────────────────────────────────────────────

export async function ingestKnowledgeDocument(input: {
  title: string;
  content: string;
  sourceType?: string;
  sourceUrl?: string;
}): Promise<{ documentId: string; chunks: number }> {
  const db = getDb();
  const [doc] = await db
    .insert(knowledgeDocuments)
    .values({
      title: input.title,
      content: input.content,
      sourceType: input.sourceType ?? "manual",
      sourceUrl: input.sourceUrl ?? null,
    })
    .returning({ id: knowledgeDocuments.id });

  const pieces = chunkText(input.content);
  for (const [index, piece] of pieces.entries()) {
    let embedding: number[] | null = null;
    try {
      embedding = await generateEmbedding(piece);
    } catch {
      embedding = null; // 无 embedding 通道 — 该块只参与 FTS
    }
    await db.insert(knowledgeChunks).values({
      documentId: doc!.id,
      chunkIndex: index,
      content: piece,
      embedding,
    });
  }
  return { documentId: doc!.id, chunks: pieces.length };
}

// ── Search ───────────────────────────────────────────────────────────

export interface KnowledgeSearchHit {
  content: string;
  documentId: string;
  title: string;
  score: number;
}

interface CandidateRow {
  id: string;
  documentId: string;
  content: string;
  title: string;
}

function parseEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return JSON.parse(value) as number[];
  return [];
}

function cosineSimilarity(a: number[], b: number[]): number {
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

export async function searchKnowledge(
  query: string,
  limit = 5,
): Promise<KnowledgeSearchHit[]> {
  const db = getDb();

  // Path 1: FTS ranking
  const ftsResult = await db.execute(sql`
    SELECT c.id, c.document_id, c.content, d.title
    FROM knowledge_chunks c
    JOIN knowledge_documents d ON d.id = c.document_id
    WHERE to_tsvector('simple', c.content) @@ plainto_tsquery('simple', ${query})
    ORDER BY ts_rank(to_tsvector('simple', c.content), plainto_tsquery('simple', ${query})) DESC
    LIMIT ${limit}
  `);
  const ftsRows: CandidateRow[] = (Array.isArray(ftsResult)
    ? ftsResult
    : [...(ftsResult as unknown as Iterable<Record<string, unknown>>)]
  ).map((r: Record<string, unknown>) => ({
    id: String(r.id),
    documentId: String(r.document_id),
    content: r.content as string,
    title: r.title as string,
  }));

  // Path 2: embedding cosine ranking (chunks without embedding are skipped)
  const vectorRows: CandidateRow[] = [];
  const embeddedChunks = await db
    .select({
      id: knowledgeChunks.id,
      documentId: knowledgeChunks.documentId,
      content: knowledgeChunks.content,
      embedding: knowledgeChunks.embedding,
      title: knowledgeDocuments.title,
    })
    .from(knowledgeChunks)
    .innerJoin(knowledgeDocuments, eq(knowledgeDocuments.id, knowledgeChunks.documentId))
    .where(sql`${knowledgeChunks.embedding} IS NOT NULL`);

  if (embeddedChunks.length > 0) {
    const queryEmbedding = await generateEmbedding(query).catch(() => null);
    if (queryEmbedding) {
      vectorRows.push(
        ...embeddedChunks
          .map((chunk) => ({
            id: chunk.id,
            documentId: chunk.documentId,
            content: chunk.content,
            title: chunk.title,
            similarity: cosineSimilarity(queryEmbedding, parseEmbedding(chunk.embedding)),
          }))
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit)
          .map(({ id, documentId, content, title }) => ({ id, documentId, content, title })),
      );
    }
  }

  // Embedding 全空（或 query embed 失败）时 rrfFuse 退化为单路 FTS 排名
  const fused = rrfFuse([
    ftsRows.map((r) => ({ id: r.id })),
    vectorRows.map((r) => ({ id: r.id })),
  ]).slice(0, limit);

  const byId = new Map<string, CandidateRow>();
  for (const row of [...ftsRows, ...vectorRows]) byId.set(row.id, row);

  return fused
    .filter((f) => byId.has(f.id))
    .map((f) => {
      const row = byId.get(f.id)!;
      return {
        content: row.content,
        documentId: row.documentId,
        title: row.title,
        score: f.score,
      };
    });
}

// ── Seed: platform image rules (idempotent by title) ─────────────────

export async function seedPlatformRules(): Promise<{ seeded: number }> {
  const db = getDb();
  const titles = PLATFORM_RULES.map((r) => r.title);
  const existing = await db
    .select({ title: knowledgeDocuments.title })
    .from(knowledgeDocuments)
    .where(inArray(knowledgeDocuments.title, titles));
  const known = new Set(existing.map((r) => r.title));

  let seeded = 0;
  for (const rule of PLATFORM_RULES) {
    if (known.has(rule.title)) continue;
    await ingestKnowledgeDocument({ title: rule.title, content: rule.content, sourceType: "platform_rules" });
    seeded++;
  }
  return { seeded };
}
