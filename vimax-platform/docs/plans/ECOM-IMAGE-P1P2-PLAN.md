# ECOM-IMAGE P1+P2 实施计划（电商硬能力 + 智能层）

> 来源：[ECOM-IMAGE-RESEARCH.md](../specs/ECOM-IMAGE-RESEARCH.md) FR-05 ~ FR-15。P0（FR-01~04）已交付。
> 执行方式：主 agent 先落契约层/地基（唯一写者，避免并行冲突），随后 4 个 subagent 并行实施文件所有权互斥的模块，最后主 agent 集成接线并全量验证。

## 文件所有权（防并行冲突）

| 所有者 | 文件 |
|---|---|
| 主 agent（先行） | `packages/contracts/src/*`、`apps/api/src/domain/agent/*`、`domain/canvas/node-executor.service.ts`、`domain/canvas/agent-result.ts`、`domain/image/cache.service.ts`、`domain/job/job-event.service.ts`（仅 image.text/compliance 分流）、`infrastructure/storage/s3.ts`（getObjectBuffer）、`infrastructure/ai`、`config/env.ts`、`trpc/router.ts`（一行注册） |
| Agent W | `workers/image/vimax_image_worker/**` + `workers/image/tests/*` |
| Agent M | `infrastructure/db/schema.ts`（追加）、drizzle 迁移、`domain/memory/**`、`domain/knowledge/**`、`domain/ecom/**`、`domain/sandbox/**`、`trpc/routers/{ecom,knowledge,sandbox}.ts`（新文件） |
| Agent E | `domain/evaluate/**`、`domain/feedback/**`、`infrastructure/observability/langfuse-score.ts`、`domain/job/job-event.service.ts`（评估/反馈 hook）、`trpc/routers/feedback.ts`（新文件） |
| Agent F | `apps/web/src/features/sandbox/**`、`apps/web/src/features/chat/*`（沙盒事件接入） |

> job-event.service.ts 由主 agent 先行（text/compliance 分流）后交给 Agent E 追加 evaluate/feedback hook，串行无冲突。

## FR-05 edit_image（mask / 局部重绘 / 换底 / 抠底）

- contracts：`ImageJobInput` 增加 `edit_op / mask_storage_key / source_storage_key / seed / text_layers / compliance_platforms`；新增 job type `image.edit`、`image.text`、`image.compliance`。
- node-executor：`runImageNode` 按 `ImageNodeData.editOp/sourceAssetId/textLayers/compliancePlatforms` 分流；`seed` 进 cache key 与 payload。
- worker：`image.edit` → inpaint/outpaint/replace_bg 走模型（source 作为参考图 + op 专属 prompt 约束；生成器签名接受 `mask_path` 时传入 mask），`remove_bg` 走 PIL 白底阈值抠图（启发式）；所有生成 PNG 写入 `AI-Generated: true` tEXt 元数据（披露）。
- 工具：`edit_image(asset_id, op, prompt?, mask_asset_id?)`。

## FR-06 burn_text（中文图内文字）

- worker 新增 `text_renderer.py`：PIL 渲染文本图层（字体复用字幕的 Noto CJK / `SUBTITLE_FONT`），输入 `text_layers[]`（text/x/y/font_size/color/align/font），输出合成 PNG。
- 工具：`burn_text(asset_id, text_layers[])` → `image.text` job → 二进制完成后走正常 asset 挂节点路径。

## FR-07 check_compliance（平台规格预检）

- worker 新增 `compliance.py`：白底占比、主体 bbox 画幅占比、最小尺寸、比例校验（Amazon/TikTok Shop/Shopee/Shopify 四平台规则表）；主图文字检测标注 `manual_review`（无 OCR，诚实降级）。
- 完成侧：`applyAgentResult` 新增 `image.compliance` case → 结果写入节点 `data.compliance`。
- 工具：`check_compliance(asset_id, platform)`；生成 PNG 默认带披露元数据。

## FR-08 SKU 库 + seed_lock 批量场景变体

- schema：`skus` / `sku_images`（多角度参考图集）/ `brand_kits`。
- `domain/ecom/sku.service.ts`：`createSkuWithImages` / `createSkuSceneBatch(canvasId, skuId, scenes[])` —— SKU 图集作为强参考 + 固定 seed，批量建 image 节点并 runNode。
- 工具：`create_sku_batch(sku_id, scenes[], aspect_ratio?)`、`register_sku(name, category, attributes, asset_ids[])`。

## FR-09 analyze_image（VLM 描述/质检/保真）

- ai-service：`AIMessage.content` 支持多模态 content parts（`image_url` data URL）；s3.ts 增加 `getObjectBuffer`。
- `domain/evaluate/analyze.service.ts`：`analyzeAsset(assetId, purpose)` → VLM JSON 输出 `{description, issues[], product_fidelity?}`。
- 工具：`analyze_image(asset_id, purpose)`；参考图先描述再进 prompt。

## FR-10 Evaluate 流水线 + 自动 refine + best-of-N

- `domain/evaluate/evaluate.service.ts`：合规 job（规则分）+ VLM judge 四维（主体准确/文字正确/美学/合规）→ 加权总分；`shouldAutoRefine(score)` 纯函数（阈值 + 每节点 ≤1 次，`data.evaluateAttempt` 计数）。
- job-event 完成路径：image 节点带 `_evaluate` 标记时异步评估，低分自动 refine 一轮（改写 prompt/换 seed）；best-of-N 复用变体画廊 + `select_best_image` 自动选用（可关）。
- 评估分写入节点 `data.evaluation` 与 trace。

## FR-11 四层记忆激活

- L0 已通（P0 历史回放）；L1：会话结束/超长 → LLM 摘要入 `agent_memory_summaries`（替换截断拼接）；L2：`user_memory_profile` 表 + 后台抽取（从对话提炼品牌/风格偏好，`remember` 工具直写）；L3：`agent_memory_messages.embedding` 继续走 JSONB 余弦（**pgvector 物理迁移延后**：需 compose 换 pgvector 镜像 + 维度选型，避免无 DB 验证的盲改，见「延后项」）。
- 决策上下文注入：`memory.service.getMemoryContext(userId)` → system prompt 段。

## FR-12 Brand Kit + search_assets

- `brand_kits` 表 + `domain/ecom/brandkit.service.ts`（颜色/字体/slogan/禁用项 → prompt 约束串）。
- 工具：`search_assets(query, scope)`（brand_kit/sku/knowledge/assets 聚合检索）、`remember(key, value)`、`save_brand_kit(...)`。

## FR-13 知识库 RAG

- schema：`knowledge_documents` / `knowledge_chunks`（jsonb embedding）。
- `domain/knowledge/knowledge.service.ts`：摄取（分块）+ **混合检索**（embedding 余弦 + Postgres FTS `to_tsvector` 双路 → RRF 融合）；embedding 走 ai-service `generateEmbedding`（provider 不支持时自动降级 FTS-only）。
- 内置平台规则包：`domain/knowledge/platform-rules.ts`（四平台图片规格，摄取即知识）+ tRPC `knowledge.ingest/seedPlatformRules/search`。

## FR-14 反馈飞轮

- schema：`feedback_events`（signal: pick/download/retry/discard/thumb_up/thumb_down）。
- `domain/feedback/feedback.service.ts`：`recordFeedback` / `exportTrainingPairs`（prompt+参数+图+信号 四元组）。
- 采集点：`pickVariant`=pick、节点删除=discard、tRPC `feedback.record`（前端 👍/👎、下载）；写 Langfuse score API（traceparent 存于 `inputSnapshot._trace`）。
- DSPy 月级优化为流程性工作，代码侧只交付数据集导出函数，不引 DSPy 依赖。

## FR-15 代码沙盒（T3 浏览器档）

- schema：`sandbox_scripts`（版本化脚本注册表）+ `sandbox_runs`（执行记录）。
- tRPC `sandbox.scripts CRUD / complete(runId, assetIds)`。
- 协议：`run_code` 决策工具 → 建 run + 向画布房间广播 `sandbox.run_requested`（contracts 新消息）；前端 `features/sandbox/pyodideRunner.ts` 从 CDN 加载 Pyodide 执行（输入取 IndexedDB 本地资产，产物走既有 requestUpload 入库）→ `sandbox.complete`。
- E2B/Firecracker（T1/T2）不在本期（research 已明确分期）。

## 验收对照

| FR | 验证方式 |
|---|---|
| FR-05 | worker 单测：edit_op 分发、remove_bg PIL 行为、mask 传参 |
| FR-06 | text_renderer 单测：CJK 图层合成输出 PNG、字体回退 |
| FR-07 | compliance 单测：四平台规则判定（白底/画幅/尺寸/比例） |
| FR-08 | sku.service 单测：批量节点参数（参考=SKU 图集、seed 固定、场景 prompt） |
| FR-09 | analyze.service 单测：多模态消息构造、JSON 解析容错 |
| FR-10 | evaluate 纯函数单测：加权/阈值/refine 上限；hook 以接口注入测试 |
| FR-11/12/13 | service 单测：摘要 prompt 构造、混合检索 RRF 合并、约束串生成 |
| FR-14 | feedback 单测：signal 归一、四元组装配 |
| FR-15 | contracts 消息 schema + 前端 runner 模块单测（CDN 加载 mock） |
| 全局 | `pnpm -r typecheck`、`pnpm --filter @vimax/api test`、web 测试、Python unittest 全绿（既有 VIMAX_ROOT 3 失败除外） |

## 延后项（明确不做，记录理由）

- **pgvector 物理迁移**：需要更换 compose 镜像 + embedding 维度选型 + 真实 DB 验证；当前 JSONB 余弦 + FTS 已满足规模。迁移作为独立 PR。
- **DSPy 月级优化 job**：流程性工作，本期交付数据集导出。
- **E2B/Firecracker**（T1/T2 沙盒）、**OCR 主图文字检测**（标注 manual_review）、**模特训练/LoRA**。
