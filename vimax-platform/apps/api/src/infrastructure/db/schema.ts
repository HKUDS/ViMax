import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const assetKindEnum = pgEnum("asset_kind", ["image", "video", "audio", "json"]);
export const assetSourceEnum = pgEnum("asset_source", ["generated", "upload"]);

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cached",
  "cancelled",
]);

export const jobEventTypeEnum = pgEnum("job_event_type", [
  "queued",
  "started",
  "progress",
  "log",
  "completed",
  "failed",
]);

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: assetKindEnum("kind").notNull().default("image"),
    mimeType: text("mime_type").notNull(),
    storageKey: text("storage_key").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    width: integer("width"),
    height: integer("height"),
    sha256: text("sha256").notNull(),
    source: assetSourceEnum("source").notNull().default("upload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // 本地化存储策略：时间戳非空 = 二进制已从对象存储删除、仅存用户设备。
    // 元数据行保留以维持节点引用；generated 资产在客户端确认落库后置位，
    // upload（用户手动上云）资产永不置位。
    offloadedAt: timestamp("offloaded_at", { withTimezone: true }),
  },
  (table) => ({
    sha256Idx: index("assets_sha256_idx").on(table.sha256),
    storageKeyIdx: index("assets_storage_key_idx").on(table.storageKey),
    offloadedIdx: index("assets_offloaded_idx").on(table.offloadedAt),
  }),
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobType: text("job_type").notNull(),
    queueName: text("queue_name").notNull().default("q.image.std"),
    bullmqJobId: text("bullmq_job_id").unique(),
    inputSnapshot: jsonb("input_snapshot").notNull(),
    cacheKey: text("cache_key").notNull(),
    outputAssetId: uuid("output_asset_id").references(() => assets.id),
    status: jobStatusEnum("status").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => ({
    cacheKeyIdx: index("jobs_cache_key_idx").on(table.cacheKey),
    statusIdx: index("jobs_status_idx").on(table.status),
    queuedAtIdx: index("jobs_queued_at_idx").on(table.queuedAt),
  }),
);

export const jobEvents = pgTable(
  "job_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    eventType: jobEventTypeEnum("event_type").notNull(),
    payload: jsonb("payload").notNull().default({}),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    jobIdTsIdx: index("job_events_job_id_ts_idx").on(table.jobId, table.ts),
  }),
);

// ── Canvas enums ───────────────────────────────────────────────────

export const canvasNodeTypeEnum = pgEnum("canvas_node_type", [
  "script",
  "character",
  "storyboard_cell",
  "shot",
  "image",
  "video",
  "concat",
  "audio",
]);

export const canvasNodeStatusEnum = pgEnum("canvas_node_status", [
  "idle",
  "running",
  "done",
  "dirty",
  "failed",
]);

// ── Canvas tables ──────────────────────────────────────────────────

export const canvases = pgTable(
  "canvases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().default("default"),
    name: text("name").notNull(),
    viewport: jsonb("viewport").notNull().default({ x: 0, y: 0, zoom: 1 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdIdx: index("canvases_tenant_id_idx").on(table.tenantId),
    updatedAtIdx: index("canvases_updated_at_idx").on(table.updatedAt),
  }),
);

export const canvasNodes = pgTable(
  "canvas_nodes",
  {
    id: uuid("id").primaryKey(), // client-assigned UUID
    canvasId: uuid("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    type: canvasNodeTypeEnum("type").notNull(),
    position: jsonb("position").notNull().default({ x: 0, y: 0 }),
    data: jsonb("data").notNull().default({}),
    outputAssetId: uuid("output_asset_id").references(() => assets.id),
    status: canvasNodeStatusEnum("status").notNull().default("idle"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    canvasIdIdx: index("canvas_nodes_canvas_id_idx").on(table.canvasId),
    canvasTypeIdx: index("canvas_nodes_canvas_type_idx").on(table.canvasId, table.type),
  }),
);

export const canvasEdges = pgTable(
  "canvas_edges",
  {
    id: uuid("id").primaryKey(), // client-assigned UUID
    canvasId: uuid("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    sourceNodeId: uuid("source_node_id")
      .notNull()
      .references(() => canvasNodes.id, { onDelete: "cascade" }),
    targetNodeId: uuid("target_node_id")
      .notNull()
      .references(() => canvasNodes.id, { onDelete: "cascade" }),
    sourceHandle: text("source_handle"),
    targetHandle: text("target_handle"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    canvasIdIdx: index("canvas_edges_canvas_id_idx").on(table.canvasId),
    sourceNodeIdx: index("canvas_edges_source_node_idx").on(table.sourceNodeId),
    targetNodeIdx: index("canvas_edges_target_node_idx").on(table.targetNodeId),
  }),
);

// ── TypeScript types ───────────────────────────────────────────────

export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobEvent = typeof jobEvents.$inferSelect;

export type Canvas = typeof canvases.$inferSelect;
export type NewCanvas = typeof canvases.$inferInsert;
export type CanvasNode = typeof canvasNodes.$inferSelect;
export type NewCanvasNode = typeof canvasNodes.$inferInsert;
export type CanvasEdge = typeof canvasEdges.$inferSelect;
export type NewCanvasEdge = typeof canvasEdges.$inferInsert;

// ── Character Library (跨画布角色管理) ──────────────────────────────

export const characters = pgTable(
  "characters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().default("default"),
    name: text("name").notNull(),
    description: text("description"),
    frontAssetId: uuid("front_asset_id").references(() => assets.id),
    sideAssetId: uuid("side_asset_id").references(() => assets.id),
    backAssetId: uuid("back_asset_id").references(() => assets.id),
    tags: jsonb("tags").default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdIdx: index("characters_tenant_id_idx").on(table.tenantId),
    updatedAtIdx: index("characters_updated_at_idx").on(table.updatedAt),
  }),
);

export type Character = typeof characters.$inferSelect;
export type NewCharacter = typeof characters.$inferInsert;

// ── Agent Chat tables ──────────────────────────────────────────────────

// ── Model management enums ──────────────────────────────────────────

export const modelTypeEnum = pgEnum("model_type", [
  "text",
  "image",
  "video",
  "tts",
  "embedding",
]);

// ── Model Configuration table ────────────────────────────────────────

export const models = pgTable(
  "models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: text("tenant_id").notNull().default("default"),
    name: text("name").notNull(),
    type: modelTypeEnum("type").notNull(),
    provider: text("provider").notNull(),
    vendorId: text("vendor_id"),
    vendorModelId: text("vendor_model_id"),
    classPath: text("class_path"),
    baseUrl: text("base_url"),
    apiKey: text("api_key"),
    config: jsonb("config").default({}),
    isDefault: integer("is_default").default(0),
    isEnabled: integer("is_enabled").default(1),
    priority: integer("priority").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    tenantTypeIdx: index("models_tenant_type_idx").on(table.tenantId, table.type),
    typeIsEnabledIdx: index("models_type_enabled_idx").on(table.type, table.isEnabled),
    oneDefaultPerTenantType: uniqueIndex("models_one_default_per_tenant_type_idx")
      .on(table.tenantId, table.type)
      .where(sql`${table.isDefault} = 1`),
  }),
);

export type ModelRow = typeof models.$inferSelect;
export type NewModel = typeof models.$inferInsert;

// ── Agent Chat tables ──────────────────────────────────────────────────

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "system",
]);

export const messageStatusEnum = pgEnum("message_status", [
  "pending",
  "streaming",
  "complete",
  "error",
]);

export const agentConversations = pgTable(
  "agent_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canvasId: uuid("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    canvasIdIdx: index("agent_conversations_canvas_id_idx").on(table.canvasId),
    updatedAtIdx: index("agent_conversations_updated_at_idx").on(table.updatedAt),
  }),
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => agentConversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    status: messageStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    conversationIdIdx: index("agent_messages_conversation_id_idx").on(
      table.conversationId,
    ),
    conversationIdCreatedAtIdx: index(
      "agent_messages_conversation_id_created_at_idx",
    ).on(table.conversationId, table.createdAt),
  }),
);

export type AgentConversation = typeof agentConversations.$inferSelect;
export type NewAgentConversation = typeof agentConversations.$inferInsert;
export type AgentMessageRow = typeof agentMessages.$inferSelect;
export type NewAgentMessage = typeof agentMessages.$inferInsert;

// ── Agent Memory tables (three-tier: short-term, summaries, RAG) ──────

export const agentMemoryMessages = pgTable(
  "agent_memory_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canvasId: uuid("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    agentType: text("agent_type").notNull().default("production"),
    role: text("role").notNull(),
    content: text("content").notNull(),
    embedding: jsonb("embedding"),
    summarized: integer("summarized").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    canvasAgentIdx: index("agent_memory_canvas_agent_idx").on(table.canvasId, table.agentType),
    summarizedIdx: index("agent_memory_summarized_idx").on(table.canvasId, table.summarized),
  }),
);

export const agentMemorySummaries = pgTable(
  "agent_memory_summaries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canvasId: uuid("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    agentType: text("agent_type").notNull().default("production"),
    summary: text("summary").notNull(),
    messageIds: jsonb("message_ids").notNull(),
    summaryEmbedding: jsonb("summary_embedding"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    canvasAgentIdx: index("agent_memory_summaries_canvas_agent_idx").on(table.canvasId, table.agentType),
  }),
);

export type AgentMemoryMessage = typeof agentMemoryMessages.$inferSelect;
export type AgentMemorySummary = typeof agentMemorySummaries.$inferSelect;

// ── Feedback flywheel (implicit + explicit user signals on generations) ──

export const feedbackEvents = pgTable(
  "feedback_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canvasId: uuid("canvas_id").references(() => canvases.id, { onDelete: "cascade" }),
    nodeId: uuid("node_id"),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    assetId: uuid("asset_id").references(() => assets.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    // pick / download / retry / discard / thumb_up / thumb_down
    signal: text("signal").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    canvasIdx: index("feedback_events_canvas_idx").on(table.canvasId),
    jobIdx: index("feedback_events_job_idx").on(table.jobId),
  }),
);

export type FeedbackEvent = typeof feedbackEvents.$inferSelect;

// ── Video Workbench table ────────────────────────────────────────────

export const workbenches = pgTable(
  "workbenches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canvasId: uuid("canvas_id").references(() => canvases.id),
    name: text("name").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    resolution: text("resolution").notNull().default("1920x1080"),
    fps: integer("fps").notNull().default(24),
    tracks: jsonb("tracks").notNull().default([]),
    coverUrl: text("cover_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    canvasIdIdx: index("workbenches_canvas_id_idx").on(table.canvasId),
  }),
);

export type WorkbenchRow = typeof workbenches.$inferSelect;

// ── Novel Import table ───────────────────────────────────────────────

export const novelImports = pgTable(
  "novel_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canvasId: uuid("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    title: text("title"),
    originalText: text("original_text"),
    chapters: jsonb("chapters").notNull().default([]),
    status: text("status").notNull().default("uploaded"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    canvasIdIdx: index("novel_imports_canvas_id_idx").on(table.canvasId),
  }),
);

export type NovelImport = typeof novelImports.$inferSelect;

// ── Auth tables ────────────────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    avatarUrl: text("avatar_url"),
    passwordHash: text("password_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("sessions_user_id_idx").on(table.userId),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

// ── E-commerce SKUs (seed-locked product identity) ────────────────────

export const skus = pgTable(
  "skus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    category: text("category"),
    attributes: jsonb("attributes").default({}),
    // seed_lock 固定种子；空 = 尚未锁定
    seed: integer("seed"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    updatedAtIdx: index("skus_updated_at_idx").on(table.updatedAt),
  }),
);

export const skuImages = pgTable(
  "sku_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    skuId: uuid("sku_id")
      .notNull()
      .references(() => skus.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id").references(() => assets.id),
    // front / side / back / detail
    angle: text("angle"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    skuIdIdx: index("sku_images_sku_id_idx").on(table.skuId),
  }),
);

export type Sku = typeof skus.$inferSelect;
export type NewSku = typeof skus.$inferInsert;
export type SkuImage = typeof skuImages.$inferSelect;

// ── Brand kits ────────────────────────────────────────────────────────

export const brandKits = pgTable("brand_kits", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // Array<{hex, usage}>
  colors: jsonb("colors"),
  fonts: jsonb("fonts"),
  slogan: text("slogan"),
  bannedWords: jsonb("banned_words"),
  guidelines: text("guidelines"),
  logoAssetId: uuid("logo_asset_id").references(() => assets.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type BrandKit = typeof brandKits.$inferSelect;
export type NewBrandKit = typeof brandKits.$inferInsert;

// ── Knowledge base (FTS + JSONB embedding dual retrieval) ─────────────

export const knowledgeDocuments = pgTable("knowledge_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  // manual / platform_rules / upload
  sourceType: text("source_type"),
  sourceUrl: text("source_url"),
  content: text("content").notNull(),
  status: text("status").notNull().default("ready"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    // number[] | null — null 时该块只参与 FTS 检索
    embedding: jsonb("embedding"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    documentIdIdx: index("knowledge_chunks_document_id_idx").on(table.documentId),
  }),
);

export type KnowledgeDocument = typeof knowledgeDocuments.$inferSelect;
export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;

// ── User memory profile (long-term user facts) ────────────────────────

export const userMemoryProfile = pgTable("user_memory_profile", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // { facts: Array<{key, value, confidence?, updatedAt}> }
  profile: jsonb("profile").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type UserMemoryProfileRow = typeof userMemoryProfile.$inferSelect;

// ── Sandbox (user scripts + runs on a canvas) ─────────────────────────

export const sandboxScripts = pgTable("sandbox_scripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  language: text("language").notNull().default("python"),
  code: text("code").notNull(),
  description: text("description"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const sandboxRuns = pgTable(
  "sandbox_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scriptId: uuid("script_id").references(() => sandboxScripts.id, { onDelete: "set null" }),
    canvasId: uuid("canvas_id")
      .notNull()
      .references(() => canvases.id, { onDelete: "cascade" }),
    // pending / running / completed / failed
    status: text("status").notNull().default("pending"),
    inputAssetIds: jsonb("input_asset_ids"),
    outputAssetIds: jsonb("output_asset_ids"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    canvasIdIdx: index("sandbox_runs_canvas_id_idx").on(table.canvasId),
  }),
);

export type SandboxScript = typeof sandboxScripts.$inferSelect;
export type SandboxRun = typeof sandboxRuns.$inferSelect;
