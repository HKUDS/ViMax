# ECOM-IMAGE P0 实施计划（链路地基）

> 来源：[ECOM-IMAGE-RESEARCH.md](../specs/ECOM-IMAGE-RESEARCH.md) 评审通过后的 P0 实施。
> 范围：FR-01 ~ FR-04。**不在本计划**：mask 编辑/压字/合规（P1）、评估闭环/记忆/知识库/沙盒（P2）。

## 调研补充发现（实施前确认）

1. **伪循环确认**：`handleChatSend`（websocket.ts:398-463）每轮用硬编码「继续」prompt 驱动，工具结果从不回喂 LLM；`runDecisionAgent` 只收单条 `userMessage`。
2. **桥接层 size 枚举 bug**：前端电商预设会写入 `1024x1536` 等尺寸（NodeInspector.tsx:1142），但 bridge 校验 `ImageJobPayloadSchema.size = z.enum(IMAGE_SIZES)` 只认 4 种旧尺寸 → 电商比例任务在桥接层必然失败。FR-02 一并修复（payload 层放宽为 `WxH` 正则，`IMAGE_SIZES` 仍约束 studio tRPC 入参）。
3. **BullMQ attempts 只覆盖转发失败**：Python 侧生成失败经 `reporter.failed` 直接终结，不会触发 BullMQ 重试 → 重试必须落在 Python worker（payload 增加 `attempt`，指数退避后重入队）。
4. **credits 无真实账本**：`credits_per_image` 仅为展示元数据，「失败不扣费」当前天然满足；P0 不引入计费改动。

## 变更清单

### FR-01 真 agent-loop

| 文件 | 变更 |
|---|---|
| `apps/api/src/domain/agent/ai-service.ts` | 导出 `AIMessage`（含 `tool` role / `tool_calls` / `tool_call_id`）；`AIStreamChunk` tool-call 增加 `toolCallId`；`includeUsage` 请求开关（`stream_options.include_usage`）+ `done` chunk 携带 usage |
| `apps/api/src/domain/agent/agent-loop.ts`（新增，纯函数） | `MAX_AGENT_STEPS=8`、`AGENT_TOKEN_BUDGET`、`canonicalToolKey`（排序稳定串接）、`toolResultMessage`（结果回喂消息，截断防上下文爆炸）、重复失败判定 |
| `apps/api/src/domain/agent/decision-layer.ts` | `runDecisionAgent` 改收 `{ canvasId, messages, … }`，system prompt 每步重建（画布快照仍每步刷新）；返回 toolCalls 携带 id 与 usage |
| `apps/api/src/realtime/websocket.ts` | 循环重写：加载会话历史（窗口 20 条）→ LLM → assistant(含 tool_calls) 入 messages → 执行工具 → tool 结果消息回喂 → 直至无 tool call / 步数 / token 预算 / 同参失败 ×2 终止 |

### FR-02 generate_image 工具重构

| 文件 | 变更 |
|---|---|
| `packages/contracts/src/schemas.ts` | `ImageJobPayloadSchema.input.size` 放宽为 `^\d{3,4}x\d{3,4}$`（修复电商尺寸桥接失败） |
| `decision-layer.ts` | `generate_assets` → `generate_image`：`kind/aspect_ratio/scene/negative_prompt/reference_asset_ids(≤4)/variants(1-4)` 全透传；比例→尺寸走 `getAspectRatioPreset`；variants>1 走既有 `runVariants` 画廊 |
| `decision-layer.ts` buildCanvasContext | 节点条目增加 `outputAssetId`，模型得以引用历史图片资产作参考图 |
| `agent-registry.ts` | 决策 Agent 工具表同步 |

### FR-03 Python worker 重试

| 文件 | 变更 |
|---|---|
| `packages/contracts/src/{schemas,job-types}.ts` | payload 增加 `attempt?: number` |
| `workers/image/vimax_image_worker/handler.py` | `_map_error` 判 retryable 且 `attempt < 2` → 指数退避（3s/6s）后 `attempt+1` 重入队，不报 failed；最终失败才 `reporter.failed` |
| `workers/image/vimax_image_worker/main.py` | 队列 key 常量收敛到 handler，避免重入队路径重复定义 |

### FR-04 Tracing 地基（W3C traceparent 贯通 + 可选 Langfuse OTLP 导出）

| 文件 | 变更 |
|---|---|
| `apps/api/src/infrastructure/observability/trace.ts`（新增） | W3C traceparent 生成/解析/子 span；`AsyncLocalStorage` 传递当前 trace；span 收集器在操作结束时一次性 OTLP/HTTP JSON 导出（`LANGFUSE_HOST/PUBLIC_KEY/SECRET_KEY` 未配置则只透传不导出，零依赖） |
| `apps/api/src/config/env.ts` | `config.observability()` |
| `websocket.ts` / `node-executor.service.ts` | chat 循环建 root span + step/tool 子 span；`runImageNode`/`runVariants` 把 `traceparent` 注入 job payload |
| `workers/image/vimax_image_worker/tracing.py`（新增） | 从 payload 提取 traceparent，日志关联 trace_id；配置了 Langfuse 时以远程父 span 导出 worker 侧 span（urllib，fire-and-forget） |

## 测试计划（TDD）

- `ai-service.test.ts`：accumulator 产出 toolCallId；includeUsage 时 done 携带 usage。
- `agent-loop.test.ts`（新增）：canonicalToolKey 键序无关；toolResultMessage 截断；重复失败 ×2 判定。
- `decision-layer.test.ts`：`buildImageNodeData`（新导出纯函数）比例→尺寸映射、kind/scene 校验、参考图截断。
- `trace.test.ts`（新增）：traceparent 格式往返、child 派生、未配置导出端点时 no-op。
- `workers/image/tests/test_retry.py`（新增，unittest）：retryable 判定 × attempt 上限 × 退避序列；payload attempt 默认值。

## 验收对照（spec FR）

- FR-01：多轮对话「把刚才那张图换成白色背景」能命中正确节点/资产并推进（工具结果在 messages 中可见）；同参失败两连即停。
- FR-02：对话指定「3:4 详情图 × 2 变体」→ image 节点 `size=1024x1536` 且经 bridge 校验通过（回归：电商尺寸不再 Invalid payload）。
- FR-03：模拟 rate_limited → worker 自动重试 ≤2 次；最终失败才落 `failed` 事件。
- FR-04：配置 Langfuse 后，chat→tool→image enqueue 的 span 同 trace；worker span 以 traceparent 关联；未配置时行为不变（仅日志关联）。
