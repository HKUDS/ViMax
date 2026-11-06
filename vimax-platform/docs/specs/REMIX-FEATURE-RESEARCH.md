# 混剪（Remix / Mashup Edit）功能调研分析报告

> 状态：调研完成，待评审
> 日期：2026-09-24
> 范围：需求定义、竞品调研、平台现状 Gap 分析、技术选型、分期实施方案

---

## 1. 需求定义

**混剪**：用户选择多个视频素材（平台生成的 video 节点产物 + 用户上传素材），可选配乐与风格主题，由系统自动完成**素材理解 → 切点规划 → 归一化 → 转场合成 → 配乐混音**，输出一条成片。典型场景：

| 场景 | 输入 | 输出 |
|---|---|---|
| 卡点混剪 | N 个视频素材 + 1 首音乐 | 按音乐节拍切换的短视频 |
| 高光混剪 | 多镜头素材 + 时长要求 | "预告片/精彩集锦"式成片 |
| 批量衍生 | 1 套素材 + 不同主题/节奏 | 多条差异化成片（营销分发） |

与现有 `concat` 节点的区别：concat 是"首尾相接直拼"；混剪的核心增量是 **素材级裁剪（trim）、节奏化切点（卡点）、转场、配乐混音、异构素材归一化**。

---

## 2. 竞品调研

### 2.1 国内产品

| 产品 | 形态 | 关键能力 | 借鉴点 |
|---|---|---|---|
| 剪映（一键成片/图文成片） | 模板驱动 | 导入素材→自动匹配模板→自动卡点+字幕+配乐；万级模板库 | **模板 = 切点节奏+转场+特效的预设参数包**，MVP 可用 3-5 个内置节奏模板替代模板市场 |
| 火山引擎智能创作云 | 企业 API | 视频混剪 API、爆款模板、亿级版权素材 | 企业级把混剪做成**原子 API/Job**，与 ViMax 的 job 架构天然对齐 |
| 必剪 / 快影 | App 内功能 | 素材高光识别 + 自动成片 | 高光识别依赖端侧能力，Web 平台可用"多模态 LLM 抽帧打标"替代 |

### 2.2 国际/开源产品

| 产品 | 关键能力 | 借鉴点 |
|---|---|---|
| Canva Beat Sync | 一键音画同步 | 交互极简：选素材→选音乐→一键 |
| Opus Clip / Vizard | 长视频→高光切片 | "AI 选段"价值最大，但依赖语音/字幕理解，范围后置 |
| BeatSync Engine、beat-synced-edit、StemSyncVideoEditor（GitHub 开源） | 音频+素材→自动节拍剪辑（AMV/GMV 场景） | 已验证 **librosa 节拍检测 → 切点表 → ffmpeg 渲染** 的管线可行性 |
| auto-editor（PyPI） | 按响度/静音自动剪辑，可导出 EDL | 切点以 **EDL（编辑决策列表）** 中间表示解耦"决策"与"渲染" |

### 2.3 结论

业界混剪的通用架构是三段式：**素材理解 → 剪辑决策（EDL）→ 渲染合成**。决策层可从规则/模板起步，后续升级为 LLM；渲染层技术收敛于 ffmpeg。ViMax 的 Chat Agent + Job 队列架构与该形态完全匹配。

---

## 3. 平台现状盘点（Gap 分析）

### 3.1 可直接复用的资产

| 能力 | 位置 | 复用方式 |
|---|---|---|
| S3 资产管线（presigned 上传/下载/预签名播放） | `apps/api/src/domain/asset/asset.service.ts`、`trpc/routers/image.ts`（assetRouter） | 素材入库直接用 |
| BullMQ→Redis→Python Worker 桥接骨架 | `apps/api/src/infrastructure/queue/{bullmq,producer,queue-config}.ts` + `vimax-platform/workers/image/vimax_image_worker/` | 新 job 类型 = contracts schema + producer 函数 + worker handler，成本低 |
| Job 状态机 + 进度推送（SSE + WebSocket 房间广播） | `apps/api/src/domain/job/job-event.service.ts`、`realtime/` | 零改动复用 |
| 节点执行模式（缓存/在途去重/级联重跑） | `apps/api/src/domain/canvas/node-executor.service.ts` | concat 节点扩展模式沿用 |
| Chat 决策层工具注册 | `apps/api/src/domain/agent/decision-layer.ts`（AGENT_TOOLS + executeToolCall + 系统提示词，共 3 处小改） | 新增 `create_remix` 类工具 |
| 前端时间线数据模型 | `apps/web/src/features/workbench/VideoWorkbench.tsx` + `packages/contracts/src/workbench-types.ts`（Track/Clip 模型，已持久化） | 后续"混剪结果微调"的现成雏形（当前无渲染消费方） |
| 素材库页面 | `apps/web/src/app/assets/page.tsx` | 需增强：缩略图、多选、视频上传 |

### 3.2 关键缺口（混剪的前置依赖）

1. **concat 仅 `-c copy` 直拼**：`workers/image/vimax_image_worker/concat_handler.py` 用 concat demuxer 流拷贝，异构素材（不同分辨率/fps/编码）会失败或花屏；无转场（`data.transition` 只进了缓存键，**未传入 worker payload**——参数断链 bug）、无逐段裁剪、无音频处理。
2. **无视频元数据探测**：全仓库无 ffprobe；`assets` 表无 `duration/fps` 字段，视频宽高由客户端自报（服务端不校验）。按节奏卡点剪切的前提能力缺失。
3. **音频能力全占位**：`audio_handler.py` 生成静音 WAV（MVP stub）；无 BGM、无节拍分析、无混音。
4. **画布不支持上传视频素材**：`CanvasProvider.tsx` 拖拽上传仅接受 `image/*`。
5. **素材库页面简陋**：无缩略图、无多选交互。

### 3.3 结论

混剪不需要颠覆性改造：**队列、资产、进度、Agent 工具注册四大基础设施全部现成**；需要补的是"渲染内核"（ffmpeg 重编码管线）和"元数据底座"（ffprobe），这两块恰好是所有视频功能的地基，投入可被 concat 增强、素材库、未来时间线导出共同摊销。

---

## 4. 技术选型

| 环节 | 候选 | 结论 |
|---|---|---|
| 元数据探测 | ffprobe（ffmpeg 自带） | **选定**。worker 镜像已含 ffmpeg，零新增依赖 |
| 节拍/能量检测 | librosa（beat_track/onset_detect）、aubio | **选定 librosa**：生态最成熟，支持变速节拍；L2 才引入（numpy/scipy 依赖较重，放 worker 镜像） |
| 渲染合成 | 原生 ffmpeg CLI（filter_complex）、MoviePy、ffmpeg-python | **选定原生 ffmpeg CLI**：与现有 concat_handler 子进程模式一致，性能最好；MoviePy 内存占用高且慢，不引入 |
| 转场 | ffmpeg `xfade`（视频）+ `acrossfade`（音频） | **选定**。注意 xfade 只处理视频轨，音频需单独 crossfade 后 amix |
| 归一化 | `scale` + `pad` + `fps` + `format` 滤镜链 + 统一编码（H.264/AAC） | **选定**。重编码换取异构素材兼容，是混剪必需 |
| 切点决策（EDL） | 规则/模板（节奏模式）、LLM（多模态抽帧理解） | **分期**：L1 用规则模板，L3 引入 LLM。EDL 定义为纯 JSON 中间表示（clips: [{assetId, in, out, transition}]），决策与渲染解耦 |
| 音轨混合 | `amix` + `sidechaincompress`（BGM 避让原声 ducking） | L2 引入；MVP 阶段 BGM 直接替换原声，简单可靠 |

---

## 5. 推荐方案：四期实施

### L0 基础设施补齐（前置，~2 类改动）

1. **ffprobe 元数据底座**
   - `assets` 表新增 `durationSec`、`fps` 列（Drizzle 迁移）；`asset_uploader.py` 上传完成时对 video/audio 执行 ffprobe 回填（修复"视频宽高=null"现状）。
   - `confirmUpload` 增加服务端异步探测（不阻塞上传响应），替代客户端自报宽高。
2. **concat 节点修复与增强**（混剪的渲染内核）
   - 修复 transition 参数断链：`RemixJobPayloadSchema`/`ConcatJobPayloadSchema` 增加 transition/mode 字段并透传 worker。
   - `concat_handler.py` 升级：统一 scale/pad/fps → 可选 xfade 转场 → 统一 H.264/AAC 重编码。保留 `-c copy` 作为同质素材快速路径。

### L1 混剪 MVP（规则模板，无音乐）

- **交互**：Chat 输入"把这 5 个视频混剪成 30 秒" → 决策层新增 `create_remix` 工具 → 自动建/复用 concat 节点（`data.mode='remix'`，含节奏模式、目标时长、素材顺序策略）→ 投递渲染 job → 产物回画布节点 + Chat 引用 chip。
- **不新增 canvas 节点类型**：把 concat 节点扩展为"合成节点"（`mode: 'sequence' | 'highlight' | 'beat'`），避免 DB pgEnum 迁移和前端 7 处注册改动；前端仅需 ConcatNode 卡片 + NodeInspector 表单增强。
- **EDL 生成**（worker 内 Python 纯函数）：输入素材元数据 + 目标时长 + 节奏模板（快切 0.6-1.2s / 标准 1.5-2.5s / 慢叙 3-4s）→ 输出切点表。
- 改动清单：
  - `packages/contracts/src/schemas.ts`：Remix 参数（mode/targetDuration/transition/clips 可选覆盖）
  - `apps/api/.../node-executor.service.ts` `runConcatNode`：透传 remix 参数（含素材 trim）
  - `workers/image/vimax_image_worker/concat_handler.py`：EDL 渲染管线
  - `apps/api/.../decision-layer.ts`：AGENT_TOOLS + executeToolCall + 系统提示词
  - 前端：ConcatNode/NodeInspector 模式选择；素材页缩略图+多选（顺带补齐）
- **测试（TDD）**：EDL 生成器纯函数单测（时长收敛、边界素材、模板切换）；ffmpeg 渲染用 2 段小样本视频做集成冒烟。

### L2 音乐卡点

- BGM 来源：用户上传音频（assetRouter 已支持 kind=audio）→ 后续再评估内置曲库（版权是产品决策，不做技术默认）。
- worker 引入 librosa：`beat_track`/`onset_detect` → 节拍时间戳 → EDL 切点对齐节拍（吸附加附：snap to nearest beat，±150ms 容差）。
- 音频：BGM 与原声 `amix`，BGM ducking（sidechaincompress）；BGM 长于成片时 fade out。
- Chat 工具参数扩展：`bgmAssetId`、`beatSync: boolean`。

### L3 智能混剪（AI 理解素材）

- 抽帧（ffmpeg thumbnail）→ 多模态 LLM 打标（镜头类型/运动强度/情绪/质量分）→ LLM 生成 EDL + 编排理由（沿用决策层 streamText 模式）。
- 价值场景：高光前置、情绪曲线编排、按剧本语义选段。依赖 LLM 成本核算，单独评审后启动。

### 明确不做（本期）

- 不做通用时间轴编辑器（VideoWorkbench 渲染导出接通是独立大项，MVP 用 EDL 自动生成）。
- 不做版权曲库、不做字幕/特效合成引擎（转场仅 xfade 预设集）。
- 不新增 Python HTTP 服务（严格走现有 Worker 桥接，符合 AGENTS.md 架构约束）。

---

## 6. 风险与待决策项

| # | 事项 | 影响 | 建议 |
|---|---|---|---|
| 1 | 重编码耗时：1080p 多段 xfade 渲染单任务可达分钟级，`q.concat.std` 并发=2 可能积压 | 用户等待体验 | 渲染进度按阶段上报（probe/EDL/render/upload 四段）；必要时拆 `q.remix.std` 独立并发配额 |
| 2 | 上传素材体积/规格上限未定义 | 大文件重编码失败与存储成本 | 定上限（如 ≤500MB/素材、≤10min）；超规格先转码代理 |
| 3 | `assets` 表无用户归属字段（全局共享） | 多租户下素材越权引用 | 若多租户是路线图项，迁移时一并补 `userId`，避免二次迁移 |
| 4 | BGM 版权 | 法务风险 | MVP 仅用户自备上传；平台内置曲库需版权采购决策 |
| 5 | xfade 链式 offset 计算：N 段转场的 filter_complex offset 随时长累积，易出 off-by-one | 渲染错位 | EDL 生成器统一计算并在单测覆盖 3/5/10 段用例 |

---

## 7. 结论

混剪功能与平台现有架构（Chat Agent → 节点 → Job → Worker → 产物回写）**零冲突**，本质是补齐"视频渲染内核"（ffprobe + 重编码 + xfade）后在 concat 节点上叠加剪辑决策层。建议按 L0→L1→L2→L3 推进：L0/L1 为一个交付单元（基础设施+规则模板混剪），L2 音乐卡点为第二交付单元，L3 智能混剪单独立项评审。
