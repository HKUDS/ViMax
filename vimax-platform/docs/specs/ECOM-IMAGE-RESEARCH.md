# 电商生图模块升级 Research（ECOM-IMAGE-RESEARCH）

> **状态**：调研完成，待评审
> **日期**：2026-10-16
> **范围**：电商/跨境电商场景下「图像生成」模块的整体升级——竞品与 VOC 调研、生图 Agent 完整链路（意图识别→推理→agent-loop→function calling→evaluate→tracing→feedback）、多轮对话与分层记忆、个人资产与知识库、代码沙盒。
> **方法**：四路并行调研（代码库现状盘点 / 海外+国内竞品 / 用户问题反馈 / Agent 架构最佳实践），关键结论均附来源，见附录 A。

---

## 0. TL;DR

1. **市场结论**：海外 Photoroom（ARR 近 $1 亿、已盈利）证明电商生图是独立赛道；通用模型（GPT Image 2、Nano Banana Pro、FLUX.2）在文字渲染与商品保真上已接近可用，但**没有合规预设、没有批量目录工作流、没有对话式 Agent**。国内绘蛙/WeShop/稿定绑定平台生态并率先 Agent 化。**空白组合 = 对话式 Agent + 平台合规 + 图→视频一体化 + SKU 级多轮保真**——恰是 ViMax「TS 决策层 + 图像/视频管线」架构的天然优势区。
2. **VOC 结论**：用户之声的主线是「**商品必须长得像实物**」压倒一切——保真度是入场券，跨图一致性是规模化门票，平台合规是生死线，中文图内文字与二次编辑决定用户是否留在工具内闭环。
3. **现状结论**：ViMax 生图链路「骨架好、神经断」：电商 kind/scene/比例预设、变体画廊、两个选优 Agent、local-first 资产、memory 表均已存在；但**多轮对话实际断裂**（`runDecisionAgent` 只传单条消息）、**agent-loop 是伪循环**（工具结果不回喂 LLM）、**memory.service 是死代码**（零调用点）、无 tracing、无评估重试、contracts 层无 mask 字段、worker 无重试执行。
4. **升级主线**：不引重框架，以现有 TS decision-layer 为核心做三层递进——**P0 修通链路地基（真 loop + 生图工具重构 + 重试 + Langfuse tracing）→ P1 电商硬能力（商品保真/局部重绘/图内文字/合规预检/批量变体）→ P2 智能层（评估选优闭环 + 四层记忆 + Brand Kit/知识库 + 沙盒与反馈飞轮）**。

---

## 1. 市场竞品调研

### 1.1 海外专业电商生图产品

| 产品 | 核心功能 | 目标客户 | 定价模式 | 关键动态 |
|---|---|---|---|---|
| **Photoroom** | 抠图/换背景、Studio HD 场景图、虚拟模特、批量 250 张、API、Brand Kit | 中小卖家→品牌 | 免费层+订阅；API 按量 | 2024 B 轮 $43M（估值 $5 亿）；ARR $40M→近 $1 亿，少数盈利的 GenAI 公司；2025 集成 GPT Image，2026 加视频与 Shopify SEO 元数据 |
| **Flair.ai** | 拖拽式 AI 商拍编辑器、团队协作、自训模型 | DTC 品牌/设计团队 | Pro $8 / Pro+ $26 / Scale $38+/月 | Scale 档开放 API |
| **Claid.ai** | API-first 批量修图+生成，2-3 秒适配平台规格，fashion 专项 | 平台/零售商（API 集成） | 免费层+订阅+API 按量 | 主打「保真关键型目录」与合规 |
| **Pebblely** | 场景图 40+ 主题、批量、AI 模特 | 小卖家 | $19/200 张、$39/500 张 | 控制粒度弱，免费层缩水 |
| **Botika** | 平铺图/人台图→AI 模特上身（虚拟试穿） | 时尚服饰卖家 | 未公开 | 2025-01 融资 $8M；3000+ 时尚品牌 |
| **ZMO.ai / Mokker** | Mokker 背景替换、ZMO AI 模特试穿 | 服装电商 | 未公开 | 宣称省 90% 模特成本 |
| **Caspa AI** | lifestyle 图+视频（含模特/动物） | DTC 品牌 | 订阅未公开 | 图+视频组合是差异化 |

格局：Photoroom 全能领先 + Claid（API/合规）+ Botika/ZMO（试穿垂直）分层竞争。**没有一家具备对话式 Agent 生图**。

### 1.2 通用生图模型的电商能力

- **OpenAI GPT Image 系列**（gpt-image-1 → GPT Image 2）：图内文字渲染准确率 95%+（英文），官方定位「生产级、适合电商卖家」——标签/包装文字、多角度主体一致。
- **Google Nano Banana Pro**（Gemini 3 Pro 底座，2025-11）：主打**参考图商品保真**（换背景/换模特不变商品）+ 可读文字渲染，已是电商参考图工作流的事实标准。我们已接入前代（`nanobanana-google`）。
- **FLUX.2**（Black Forest Labs，2025-11）：最多 **8 张参考图**做跨批次商品一致性、4MP 输出、开放权重可自托管；2025-12 B 轮 $300M。
- **共识分工**：Midjourney 美学最强但无电商工作流；Ideogram 图内文字最可读；Recraft 面向品牌一致性与可编程 API。
- **共性短板**（垂直层机会）：无平台合规预设、无批量目录管理、商品保真依赖提示词技巧、无多轮迭代一致性。

### 1.3 国内产品

| 产品 | 核心功能 | 生态绑定 | 特色 |
|---|---|---|---|
| **阿里绘蛙** | AI 模特（30 分钟训练专属模特）、商品模型训练、商拍图+种草文案（输入链接自动生成） | 淘宝/天猫 | 图+文+模特一体，服务森马/SHEIN |
| **美图设计室** | AI 模特试衣（同模特同服装多姿势系列图）、AI 商品图、口播视频 | 泛电商/小红书 | 系列图一致性强 |
| **WeShop 唯象** | AI 模特+静物；**模特试穿 Agent**（1 张照片一键上身）；图生视频 | 独立/海外版 | 国内首款 AI 商拍；2025 Agent 化+视频化 |
| **稿定 AI** | 生图/视频/**Agent 创作模式**（自然语言拆解多步任务）、亚马逊主图/抖音/淘宝模板、尺寸自动适配、卖点文案 | 多平台模板库 | 旗下 insMind 出海 |
| **京东羚珑 / JoyAI** | 主图、banner、店铺页智能设计 | 京东商家 | 平台标准化设计绑定深 |
| **字节即梦+豆包** | 豆包写词→即梦生图、局部重绘/扩图/消除 | 抖音生态 | 「组合工作流」是民间主流打法 |
| **阿里 PicCopilot** | 模特图/海报/详情页、**图片多语言转换** | 跨境卖家 | 跨境本地化方向 |

### 1.4 平台合规与跨境产品化

- **Amazon**：主图纯白 RGB(255,255,255)、产品占画幅 ≥85%、推荐 1000px+、主图禁文字/水印/logo；部分类目放宽允许 lifestyle 主图；**2026-07 起强制对 AI 生成真人打元数据披露标签**（纽约州法案驱动）。
- **TikTok Shop**：主图白底正面、≥600×600（推荐 800×800）、1:1、每商品 ≤9 图、每变体 ≤3 图、禁水印/促销文字；已加入 AI 内容披露与 listing 质量分层。
- **Shopee / Shopify**：≥500×500 推荐 1024×1024 1:1 / 推荐 2048×2048 4:5。
- **A/B 测试**：Amazon 原生 Manage Your Experiments 支持主图 A/B；Amazon AI Creative Studio（免费）生成 lifestyle 图，代理商口径 CTR 提升约 40%；**「生成变体→测图→回流」的第三方闭环工具稀缺**。
- **多语言本地化**：PicCopilot 图多语言转换、PicTech 图片翻译均为独立小工具，**尚未有大平台整合**。

### 1.5 竞品矩阵与市场空白

| 能力 | Photoroom | Flair | Claid | Botika | 通用模型 | 绘蛙 | WeShop | 稿定 |
|---|---|---|---|---|---|---|---|---|
| 白底/场景图 | ✅ | ✅ | ✅ | — | ✅需技巧 | ✅ | ✅ | ✅ |
| 模特试穿 | ✅ | ✅ | ✅ | ✅✅ | ✅ | ✅ | ✅Agent | — |
| 批量/API | ✅✅ | ✅ | ✅✅ | — | ✅API | — | — | 模板批量 |
| 平台合规预设 | ✅Shopify | — | ✅✅ | — | ❌ | 淘系 | — | ✅多平台 |
| 对话式 Agent | ❌ | ❌ | ❌ | ❌ | ✅通用 | ❌ | ✅单一 | ✅ |
| 图→视频一体化 | 起步 | ❌ | ❌ | ❌ | 分离 | 短视频 | ✅ | ✅ |
| Brand Kit/一致性 | ✅ | 模型训练 | ✅ | — | 参考图 | 模特训练 | 固定模特 | ❌ |

**六个市场空白点**：① 对话式 Agent + 平台合规检查的组合；② 生图→商品视频→广告投放一体化；③ SKU 级多轮迭代保真（改背景/文案不动商品）；④ A/B 测试闭环；⑤ 多语言营销图本地化整合；⑥ AI 真人披露元数据自动化。

**对我方的 7 条启示**：
1. 把平台合规做成 **Agent 工具**（白底检测、85% 画幅、尺寸适配、禁文字检查、AI 披露元数据）——生成即合规，所有通用模型和多数垂直产品都缺。
2. **SKU 锁定的参考图管线**：借鉴 FLUX.2 多参考 + Nano Banana Pro 保真模式，商品主体跨轮次/跨场景不变。
3. **图→视频一体化是最大差异化**：生图节点直接接入既有 pipeline-orchestrator 产出商品视频/口播 TTS。
4. **Brand Kit + 模特记忆库**：品牌色调/字体/SKU 库/专属模特持久化，跨图跨批次一致。
5. 复用 ad-variants 做**主图钩子变体批量**，输出可直接投 Amazon Experiments 的素材组。
6. 用文字渲染强的模型按目标市场语言**重渲染图内文字**；中文走「无字底图+程序化压字」兜底。
7. AI 生成真人图**自动写入披露元数据**，规避 Amazon/TikTok 新规下架风险。

---

## 2. 用户问题反馈（VOC）

### 2.1 高频硬伤

1. **商品保真走样（最高频）**：logo/标签文字/图案变形、颜色偏差、版型失真。Flair 用户评价「AI struggles to maintain the exact shape, text, and logos」；国内实测吐槽「颜色偏差大，版型完全不对」「刺绣细节实物上不存在」。
2. **中文文字渲染乱码**：「夏日促销5折起」生成「夏$%日促&*」；媒体定性为「所有生图模型硬伤、阻碍亚洲市场」；主流民间解法是**无字底图+后期压字**。
3. **手部/细节崩坏**：女装区「六指模特」泛滥；多件套装商品常被合并成一个物体。
4. **背景假、过度完美不真实**：Photoroom 用户称 backdrops「clearly AI generated」；Etsy 卖家「too perfect...feel unnatural」；Clutch 调研 95% 消费者对 AI 图有疑虑。
5. **批量/跨图一致性缺失**：AI 模特无法固定曾是 WeShop 头号痛点；光影与构图跨目录漂移；多角度一致仍是未满足需求。
6. **成本与额度陷阱**：「30 欧买的 token 一天烧完」、额度不滚存、失败生成也扣费——直接摧毁订阅信任。
7. **二次编辑能力弱**：局部重绘/改字能力缺失，用户被迫回 PS。

### 2.2 低频但致命

- **平台合规/封号**：Amazon AI 真人元数据强制披露（2026-07 起）、主图须真实反映商品否则账号处置；国内平台启动 AI 假图治理。
- **信任崩塌**：r/ecommerce 高赞「Don't use AI photos. You will lose all sales and credibility」；「货不对板」已产生消费维权案例。

### 2.3 对话式/Agent 生图的特殊反馈

- **多轮修改中商品漂移**是核心抱怨（改一次背景，商品本身变了）。
- 用户困惑「反复改一张图」与「围绕同一商品出整套素材」是两种不同能力——产品要显式区分。
- prompt 门槛高，催生提示词模板产业——**结构化参数（机位/光影/文案）应替代裸 prompt**。

### 2.4 痛点 Top 10（频率×严重度）与解法方向

| # | 痛点 | 产品解法方向 |
|---|---|---|
| 1 | 商品保真（logo/图案/版型/色） | 商品参考图强约束 + 多图参考 + 保真度自动校验 |
| 2 | 中文文字乱码 | 文字图层分离：无字底图 + 程序化压字 |
| 3 | 手部/细节崩坏 | 崩坏检测 + 自动 inpainting 修复 |
| 4 | 批量/SKU 跨图一致性 | 锁定商品层与种子，场景模板批量套用 |
| 5 | 生成后编辑弱 | 内置局部重绘/扩图/改字，免回 PS |
| 6 | 额度/成本陷阱 | 失败不扣费、按合格产出计费 |
| 7 | 背景/光影假 | 物理正确阴影合成；VLM 质检拦截 |
| 8 | 上传素材门槛 | 素材质检引导（多角度、白底、无遮挡） |
| 9 | 合规风险 | AI 标注元数据 + 主图白底/货不对板预检 |
| 10 | 对话式不可控 | 结构化参数替代纯 prompt，商品层锚定 |

---

## 3. 现状盘点（ViMax 生图链路能力）

### 3.1 已有资产（可复用）

- **决策层骨架**：`apps/api/src/domain/agent/decision-layer.ts` 10 个工具 + OpenAI function calling（Zod→JSON Schema，流式 tool-call 累积）；agent-loop 骨架在 `realtime/websocket.ts` `handleChatSend`（`MAX_AGENT_TURNS = 6`）。
- **Canvas 管线**：8 类节点；`runImageNode`（node-executor.service.ts:604）已支持 upstream 参考图→i2i、sha256 缓存、in-flight 去重；电商 `ImageNodeKind`（product/scene/model/ad）、`ECOMMERCE_ASPECT_RATIOS`（主图 1:1/详情 3:4/Banner 16:9/信息流 9:16）、`ECOMMERCE_SCENES`（含 clean-white）与 3 个电商 workflow 模板。
- **选优 Agent 已桥接**：`pipeline.select_best_image`（VLM 按参考一致性挑最优）、`pipeline.select_reference`；变体画廊 VariantGallery「生成 N 张→人工选用」。
- **记忆表已建**：`agent_memory_messages`（含 jsonb embedding）+ `agent_memory_summaries` 三张表 + `domain/memory/memory.service.ts` 三层检索——**但全仓库零调用点（死代码）**，摘要只是截断拼接，embedding 无生产来源。
- **local-first 资产**：IndexedDB 本地金库 + offload/TTL 清扫成熟；商品链接元数据提取（`domain/ad/product-url.ts`，含 SSRF 防护）。
- **双生图模型**：豆包 Seedream 4.0（yunwu/ark）+ Gemini 2.5 Flash Image（nanobanana）。

### 3.2 能力缺口清单

| 能力 | 状态 | 关键证据 | 升级动作归属 |
|---|---|---|---|
| 意图识别 | 部分支持 | 仅 system prompt + function calling 隐式路由，无槽位结构/置信度 | §4.2 |
| 多轮对话上下文 | **缺失（有表无链路）** | `runDecisionAgent` 只传单条 userMessage（decision-layer.ts:375），消息持久化但不回喂 | §4.2 / §7 |
| agent-loop | 部分支持（伪循环） | websocket.ts:398-463 硬编码 6 轮 + 固定「继续」prompt；**工具结果不回喂 LLM** | §4.4 |
| function calling | 已支持 | ai-service.ts tools 格式；但生图工具 `generate_assets` 固定 1024×1024、无参数透传 | §4.5 |
| evaluate 选优 | 部分支持 | 选优靠用户手点；无自动评分、无失败/低质重生成；worker 无重试执行（retryable 只是标记） | §4.6 |
| tracing 观测 | **缺失** | 仅 job_events 进度事件与 console.error | §4.7 |
| 用户反馈闭环 | 部分支持 | 仅变体「选用」；无 👍/👎、无隐式信号回流 | §4.8 |
| 分层记忆 | 部分支持（死代码） | memory.service.ts 三层设计齐备但零调用、摘要未用 LLM | §7 |
| 知识库/RAG | **缺失** | 无 knowledge 表、无摄取/分块/检索链路 | §8.2 |
| 个人资产库 | 部分支持 | 无云端资产浏览页/标签检索/Brand Kit/SKU 库 | §8.1 |
| 代码沙盒 | **缺失** | 仅 vendor JS 插件 Sucrase 沙箱（vendor-registry.ts:120） | §9 |
| 电商特化 | 部分支持 | 预设止于 prompt 拼接；**contracts 层无 mask 字段**；缺真白底抠图、模特试穿、图内文字、批量 SKU、平台合规校验 | §4.5 / §10 |

---

## 4. 生图 Agent 完整链路设计

### 4.1 总体架构

```
用户输入（文字+图片+商品链接）
   │
   ▼
┌──────────────────────────── TS 决策层（唯一编排权） ────────────────────────────┐
│ ① 意图识别  LLM function calling 联合抽取（intent+槽位+引用消解），澄清 ≤1 轮      │
│ ② 上下文装配  对话历史(窗口) + 画布快照 + 记忆检索(L1摘要/L2画像/L3向量) + 知识库   │
│ ③ Agent Loop  LLM →(并行)tool calls → 结果回填 → 再决策；canonical 判重；双预算    │
│    │                                                            │
│    ▼ 工具面                                                      ▼ 评估
│  generate_image / edit_image(mask) / analyze_image /              critic（VLM 打分）
│  burn_text / check_compliance / search_assets / remember /       best-of-N rerank
│  create_ad_variants / run_node …                                 自动 refine ≤1 轮
│    │
│    ▼ BullMQ（traceparent 注入 job payload）
└────┼───────────────────────────────────────────────────────────────┘
     ▼
Python Workers（image/pipeline）──OTel span link 挂回原 trace──▶ Langfuse（自托管）
     │                                                          ▲
     ▼ 产出 asset                                                  │ score
  画布节点回填 → 隐式信号（选用/下载/重试/废弃/编辑率）+ 显式 👍/👎 ──┘
     │
     ▼ 四元组数据集 (prompt, 参数, 图, 信号)
  数据飞轮：DSPy 月级优化 prompt 模板 + 用户偏好画像注入（记忆 L2）
```

设计原则（对应 Anthropic《Building Effective Agents》结论）：**固定 workflow 优先**（plan→generate→critique→refine ≤2 轮），不引重框架，不上自主多 agent；编排权始终在 TS orchestrator，Python Agent 仍是原子 job。

### 4.2 意图识别

- **不做独立分类器**。用 LLM function calling 做**意图+槽位联合抽取**，schema 输出：`intent`（generate / edit / batch_variants / ask / compliance_check / asset_query …）、`target_asset_refs`（画布节点/资产引用消解：「这张图」「刚才那张」）、`style`、`aspect_ratio`、`platform`（amazon/tiktok/shopify…）、`ref_image_ids`。
- **多模态输入**（图片+文字）经 VLM 统一编码进上下文；「编辑这张图」类指令必须做图像引用消解后映射到 `assetId/nodeId`。
- **澄清策略**：槽位缺失且代价高（如无商品参考图的「白底图」请求）才追问，**最多 1 轮**；其余用默认值+生成后让用户改，避免「审讯式」交互。
- 可选优化：首 token 前用快速模型 triage 拦截明确命令（「重画」「放大」），降低延迟与成本。

### 4.3 推理与规划

- 生图任务步骤少，**固定 pipeline 而非 ReAct 自主循环**：`plan（拆参数）→ generate → critique → refine（≤1 轮）`。
- 批量/变体场景用 **orchestrator-workers 并行**：一次 parallel tool calls 生成 N 张变体，再由 critic/BestImageSelector 评选。
- 复杂请求（「给这个 SKU 出一整套 listing」）规划为**画布子图**：plan 输出节点清单→autoWire→逐节点 runNode，复用现有 `create_canvas_nodes` + pipeline-orchestrator。

### 4.4 Agent Loop（伪循环 → 真循环，P0 核心）

现状问题：`handleChatSend`（websocket.ts:398-463）每轮只把画布快照注入 prompt 驱动推进，**工具执行结果没有作为 tool result message 回喂 LLM**。

改造：

1. 构造标准 messages 数组（system + history + user + assistant.tool_calls + tool 结果），每轮 tool 结果回填后再调 LLM，直到无 tool call 或触达上限。
2. **终止与防死循环**：`max_steps = 8`；token/费用双预算封顶；`canonicalize(toolName + 归一化 args)` 判重——完全相同的失败调用第二次出现即终止并把错误汇总给用户，而非无限重试。
3. **错误即工具结果**：工具失败原样回填（错误码+建议），让模型自纠；不在框架层吞错。
4. **并行 tool calls**：变体批量、多参考检索并行下发。

### 4.5 Function Calling 生图工具面（重构 `generate_assets`）

| 工具 | 参数（摘要） | 说明 |
|---|---|---|
| `generate_image` | `prompt, aspect_ratio, kind, scene, model, reference_asset_ids[], n(变体数), negative_prompt, seed_lock` | 替代现有固定 1024×1024 的 `generate_assets`；参数全部透传到 `ImageGenerateInputSchema` |
| `edit_image` | `asset_id, op(inpaint/outpaint/remove_bg/replace_bg), mask_asset_id, prompt` | **contracts 层新增 mask 字段**（`ImageGenerateInputSchema` + `ImageJobInput`），worker 侧接对应模型能力 |
| `burn_text` | `asset_id, text_layers[], font, color, layout` | 图内文字图层分离：无字底图 + 程序化压字（VOC #2 的根治方案） |
| `analyze_image` | `asset_id, purpose(describe/qc/product_fidelity)` | 参考图先经视觉分析再进 prompt（避免模型盲传）；兼做质检 |
| `check_compliance` | `asset_id, platform(amazon/tiktok/shopee/shopify), slot(main/gallery)` | 白底检测、画幅占比、尺寸、禁文字、AI 披露元数据检查 |
| `search_assets` | `query, scope(brand_kit/sku/kb/assets)` | Brand Kit/SKU 库/知识库检索（§8） |
| `remember` | `key, value, scope(user/brand)` | 写入用户/品牌记忆（§7） |
| 既有保留 | `create_ad_variants / extract_product / run_node / create_canvas_nodes / generate_script / generate_storyboard / extract_characters` | 广告域与画布编排不变 |

### 4.6 Evaluate（评估与选优闭环）

**三级评估流水线**（生成后自动执行，结果入 trace 与节点 data）：

1. **规则/粗筛**：尺寸/比例/白底像素占比（电商主图）；OCR 校验图内文字与目标文案一致性。
2. **一致性**：VLM 对比「输出 vs 商品参考图」输出保真度分（VQAScore 思路：对「图是否符合 prompt」输出 yes 概率）；手部/崩坏启发式检测。
3. **MLLM-as-judge 维度打分**：主体准确 / 文字正确 / 美学 / 合规 四维 1-5 分。

**闭环动作**：四维加权分低于阈值→自动 refine 一轮（重写 prompt 或换 seed）或 best-of-N 重生成，**最多 1 次，成本封顶**；多候选时复用已桥接的 `pipeline.select_best_image` 做自动 rerank，用户仍可 override。prompt 模板回归用 promptfoo（CI）+ 线上抽样人评。

### 4.7 Tracing（可观测）

- **选型：Langfuse 自托管**（开源，契合 local-first 资产策略；原生 OTLP 端点兼容 OTel GenAI semconv）。备选 Helicone（网关旁路、改造成本低但深度弱）。
- **链路贯通**：API 侧每次 `runDecisionAgent`/工具执行产一个 trace；BullMQ 入队时把 **W3C traceparent 注入 job payload**，Python worker extract 后以 span link 挂回原 trace——与「TS orchestrator → BullMQ → Python worker」架构一一对应。OTel GenAI semconv 尚未 stable，封装一层薄 `gen_ai.*` 属性适配器。
- **记录内容**：prompt（含记忆/知识库注入片段）、模型、参数、参考图指纹、成本、评估四维分、用户反馈 score。`job_events` 仍是领域进度事件（前端 SSE 用），trace 是观测面，二者不混用。

### 4.8 Feedback（反馈闭环与数据飞轮）

- **隐式信号优先**（量大、无偏）：`pickVariant` 选用=正、下载=强正、重试/改 prompt 再生成=负、节点删除/废弃=负、编辑率=部分负。显式 👍/👎 辅助校准。
- 全部信号经 Langfuse score API 写回对应 trace，形成 **(prompt, 参数, 图, 信号) 四元组**数据集。
- 消费路径：① 月级用 DSPy（GEPA/BootstrapFewShot）以「被采纳生成」为样本优化各电商场景 prompt 模板；② 用户偏好画像（风格/色调/构图倾向）写入记忆 L2 注入 system prompt；③ 后续可在线 bandit 选 prompt 变体。
- 计费配合 VOC #6：**失败任务不扣 credits，仅合格产出计费**（worker `_map_error` 已分类 retryable，配合 §4.4 重试）。

---

## 5. 多轮对话架构与分层记忆

### 5.1 对话上下文重构（P0）

- `runDecisionAgent` 改为接收 `messages[]`（近期对话窗口，如最近 10-20 条），而非单条 userMessage；`agent_conversations`/`agent_messages` 已有的持久化数据开始真正参与模型上下文。
- 上下文装配顺序（预算敏感，越靠前越重要）：system（含记忆 L2 画像）→ 记忆 L1 会话摘要 → 知识库检索片段 → 画布快照 → 近期历史窗口 → 当前输入。

### 5.2 四层记忆设计

| 层 | 内容 | 存储 | 写入时机 | 读取时机 |
|---|---|---|---|---|
| **L0 working** | 当前会话消息+画布状态 | `agent_messages`（已有）+ 画布快照 | 每轮 | 每轮（窗口化） |
| **L1 episodic** | 会话级摘要（做了什么、定了什么） | `agent_memory_summaries`（已有，**摘要改 LLM 生成**，替换现在的截断拼接） | 会话结束/超长时 | 新会话引用同一画布/商品时 |
| **L2 semantic/profile** | 用户与品牌持久事实：品牌色/字体/禁用项、常用品类、风格偏好、常用机位 | 新增 `user_memory_profile`（结构化 JSONB + 置信度 + 来源消息引用） | 从 L0/L1 异步抽取（`remember` 工具 + 批量抽取 job） | 每次决策注入 system prompt |
| **L3 vector** | 历史消息/资产描述的语义检索 | `agent_memory_messages.embedding`（**JSONB 余弦 → 迁移 pgvector**） | 每轮 | 相似意图/相似商品时检索 top-k |

实施要点：**激活现有 memory.service.ts 死代码**而非重写；L2 抽取是后台 job（低频、便宜模型）；每层独立开关与 TTL（L0 会话级、L1 90 天、L2/L3 用户删除即清除，满足合规）。生图场景以事实型记忆为主，**暂不需要知识图谱**（Mem0/Zep 图谱方案评估后明确不引入）。

---

## 6. 用户个人资产与知识库

### 6.1 资产库升级（Brand Kit / SKU 库 / 模特库）

- **Brand Kit**：logo、品牌色板（hex + 用途）、字体、slogan——结构化业务表；生图时自动注入约束（色调/字体/禁用项），`burn_text` 优先用品牌字体。
- **SKU 库**：一个商品的**多角度参考图集**（正面/侧面/细节/吊牌）+ 属性（类目/颜色/材质/尺寸）；生图时 SKU 图集作为强参考注入（对应 FLUX.2 多参考模式），`seed_lock` + 商品层锚定实现跨轮次保真。
- **模特库**：参考图集（一致性靠参考而非训练，P2 不做模型训练）；AI 生成模特资产**自动打披露元数据**。
- **云端资产浏览页**：补齐列表/标签/收藏/按画布筛选（现在只有 `app/assets/[id]` 详情页）；local-first offload 策略保持不变，Brand Kit/SKU 库属用户显式上传（`source=upload`，永不自动清除）。

### 6.2 知识库与 RAG

- **范围**：品牌知识（品牌手册、卖点文档）、品类知识（拍摄规范）、平台规则（Amazon/TikTok 合规文档，内置官方规则包随版本更新）、用户上传文档（产品说明书）。
- **技术**：**pgvector + 行级隔离（RLS）+ BM25/RRF 混合检索**（先 pg tsvector 兜底，规模大再上 ParadeDB）；复用现有 Postgres，不引独立向量库（>1 亿向量再评估 Qdrant）。多租户按 `user_id/org_id` RLS，worker/admin 显式绕过需审计。
- **链路**：摄取（上传/URL）→ 分块 → embedding（文本 + 关键资产多模态描述）→ 混合检索 → 注入决策上下文；Agent 经 `search_assets(scope=kb)` 主动检索。
- 新表：`knowledge_documents` / `knowledge_chunks`（含 embedding、chunk 元数据、来源引用）。

---

## 7. 代码沙盒架构

**定位**：承载用户自定义/Agent 生成的**图像后处理脚本**（批量水印、多尺寸导出、自定义合成、平台规格裁切）与未来的数据脚本。这是「可编程电商生图平台」差异化能力的地基。

```
canvas `code` 节点 / 决策工具 run_code
        │
        ▼
api: sandbox.service（TS）──排队──▶ sandbox-executor worker
        │ 脚本注册表 sandbox_scripts（版本化、审核状态、资源配额）
        ▼
沙盒运行时（三档）：
  T1 托管 E2B（Firecracker microVM，冷启动 ~125-700ms）——首选，省运维
  T2 自建 Firecracker + egress 白名单代理——量大后迁移
  T3 浏览器端 Pyodide/WASM——纯客户端轻量处理（契合 local-first，零服务端成本）
        │
        ▼ 产物（图片/JSON）→ 资产库；stdout/耗时/退出码 → trace
```

**安全基线（比隔离层更重要）**：出口网络默认全断、白名单代理放行（仅允许拉取平台素材域名）；每运行 CPU/内存/超时/磁盘配额；脚本版本化 + 首次运行审核；secrets 不进沙盒（由 executor 代取注入环境）。参考结论：**egress 管控优先于隔离层本身**——gVisor + 锁死出口优于 microVM + 裸网络。

**分期**：P2 先落 T3（Pyodide，覆盖裁切/加水印/尺寸批量等纯计算任务，零基础设施）；T1/T2 在自定义脚本需求验证后启动。与既有 `vendor-registry.ts` 的 Sucrase JS 插件沙箱互补（后者仅限受信 JS vendor 适配器）。

---

## 8. 电商特化能力包（对应 VOC Top 10）

| 能力 | 方案 | 覆盖 VOC |
|---|---|---|
| 商品保真 | SKU 多角度图集强参考 + `analyze_image(product_fidelity)` 生成后校验 + 不达标自动 refine | #1 |
| 中文图内文字 | `burn_text` 文字图层分离：无字底图（模型）+ 程序化压字（sharp/ffmpeg，品牌字体）；英文可用 GPT Image 直出 | #2 |
| 崩坏修复 | critic 检测（手部/畸变）→ `edit_image(inpaint)` 自动修复 | #3 |
| 批量一致性 | SKU 锚定 + 场景模板批量套用（复用 ad-variants 并行机制）+ `seed_lock` | #4 |
| 二次编辑 | `edit_image`（inpaint/outpaint/remove_bg）进 NodeInspector 与对话 | #5 |
| 合规 | `check_compliance` 内置四平台规格 + AI 披露元数据自动写入 + 导出适配 | #9 |
| 上传引导 | 素材质检（白底/多角度/遮挡检测）上传即反馈 | #8 |
| 成本信任 | 失败不扣费 + 评估分与生成理由展示（透明化） | #6 |
| 平台结构化参数 | kind/scene 基础上增加**机位/光影/构图**结构化控件，替代裸 prompt | #10 |
| 背景真实性 | 场景 prompt 模板强化物理阴影描述 + critic 质检拦截 | #7 |

---

## 9. 升级路线图

### P0 — 链路地基（一切的前置，约 2-3 周）

| FR | 内容 | 验收标准 |
|---|---|---|
| FR-01 | 真 agent-loop：工具结果回填、messages 历史、max_steps/费用双预算、canonical 判重 | 多轮对话中「把第二张图换成白色背景」能引用正确资产并返回生成结果摘要 |
| FR-02 | `generate_image` 工具重构：比例/kind/scene/参考图/变体数透传 | 对话指定 3:4 主图 + 2 变体，落库参数与画布节点一致 |
| FR-03 | worker 重试执行：retryable 错误指数退避重试 ≤2 次，失败不扣 credits | 模拟 rate_limited 任务自动恢复；失败任务 credits 不变 |
| FR-04 | Langfuse tracing：traceparent 贯通 TS→BullMQ→Python | 任一生成可在 Langfuse 看到完整链（决策→工具→worker span）与成本 |

### P1 — 电商硬能力（直接回应 VOC Top5，约 3-4 周）

| FR | 内容 | 验收标准 |
|---|---|---|
| FR-05 | contracts/worker 增加 mask 与 `edit_image`（inpaint/outpaint/remove_bg/replace_bg） | 对生成图框选区域改背景，商品主体像素级不变 |
| FR-06 | `burn_text` 文字图层（中文压字，品牌字体） | 含中文卖点的详情图文字 OCR 校验 100% 正确 |
| FR-07 | `check_compliance` 四平台规格 + AI 披露元数据 | Amazon 主图导出通过白底/画幅/禁文字检查并带披露元数据 |
| FR-08 | SKU 库 + 多参考强约束 + `seed_lock` 批量场景变体 | 同一 SKU 批量 6 张不同场景图，商品保真 VLM 校验通过率 ≥90% |
| FR-09 | `analyze_image`（描述/质检/保真）工具 | 参考图描述注入 prompt；质检分数落节点 data |

### P2 — 智能层（评估闭环 + 记忆 + 知识库 + 沙盒，约 4-6 周）

| FR | 内容 | 验收标准 |
|---|---|---|
| FR-10 | Evaluate 流水线（OCR/白底规则 + VLM 保真 + judge 四维）+ 阈值自动 refine ≤1 轮 + best-of-N 自动选优 | 低质图自动重生成一次；选用率（隐式正反馈）较基线提升可测 |
| FR-11 | 激活记忆四层：LLM 会话摘要、user_memory_profile 抽取注入、pgvector 迁移 | 第二次会话说「老规矩」能命中品牌偏好；用户删记忆即全清 |
| FR-12 | Brand Kit + `search_assets` 注入生图约束 | 设定品牌色后生成的详情页文字与色调符合品牌板 |
| FR-13 | 知识库 RAG（pgvector + RLS + 混合检索）+ 平台规则内置包 | 上传品牌手册后，相关问询回答引用手册内容并可溯源 |
| FR-14 | 反馈飞轮：隐式信号→Langfuse score→四元组数据集→月级 DSPy 模板优化 | 每月出 prompt 模板优化报告，模板变更走 promptfoo 回归 |
| FR-15 | 沙盒 T3（Pyodide）+ `run_code` 工具 + 脚本注册表 | 批量多尺寸导出脚本在浏览器沙盒完成，产物入资产库 |

### 不做列表（本期明确排除）

- 自主多 Agent 框架（LangGraph/AutoGen 全家桶）与跨厂商 A2A——固定 workflow 足够。
- 模型训练/LoRA（专属模特训练）——用参考图一致性替代，验证需求后再评估。
- 独立向量数据库（Qdrant/Milvus）、知识图谱记忆（Zep/Graphiti）——pgvector 够用。
- Firecracker 自建沙盒（P2 只做 Pyodide 档）。
- 模特训练式换装（Botika 类）——先以参考图试穿验证。

### 风险与开放问题

1. **模型依赖**：保真与文字渲染强依赖 Seedream/Nano Banana 能力上限；FLUX.2（8 参考图、可自托管）与 GPT Image 是否接入需成本评估。
2. **成本**：critic（VLM 调用）+ best-of-N 会推高单图成本，需与「失败不扣费」的定价模型一起核算。
3. **semconv 未 stable**：OTel GenAI 属性演进可能需适配层升级。
4. **合规元数据标准**：Amazon 2026-07 新规的具体元数据格式需在 FR-07 实施前核实（C2PA vs 平台自定义字段）。
5. **OCR 中文校验**的准确率基线需先测（影响 FR-06 验收方式）。

---

## 附录 A：关键来源

**竞品/市场**：Photoroom B 轮（balderton.com）、Photoroom API（photoroom.com/blog）、Flair 定价（flair.ai/pricing）、Claid（claid.ai）、Pebblely（pebblely.com/pricing）、Botika（botika.com）、ZMO（zmo.ai）、Caspa（caspa.ai）、VModel（vmodel.ai）；GPT Image 2（openai.com）、Nano Banana Pro（blog.google）、FLUX.2（bfl.ai、TechCrunch 2025-12）、Recraft（recraft.ai）；绘蛙（ihuiwa.com）、美图设计室（designkit.cn）、WeShop（weshop.com）、稿定（gaoding.art）、羚珑（ling.jd.com）、即梦（jimeng.jianying.com）、PicCopilot（piccopilot.com）。

**平台合规**：Amazon 图片规格（sellercentral.amazon.com G1881）、AI 真人披露（CNBC 2026-07-23）、TikTok Shop 规则（seller-us.tiktok.com）、Shopee（golocad.com）、Shopify（shopify.com/blog/ai-image-generator）、Amazon A/B（helium10.com）、Amazon AI Creative Studio（sequencecommerce.com）。

**VOC**：Flair Trustpilot、Photoroom App Store 评价、r/EtsySellers、r/ecommerce、新京报（AI 商品图货不对板实测）、南都（AI 假图治理）、新浪科技（中文渲染硬伤）、新华网（消费维权）、WizCommerce（Pebblely 评测）。

**架构**：Anthropic《Building Effective Agents》（anthropic.com/engineering）、OpenAI Agents SDK 与 Guardrails（openai.github.io）、Talk2Image（arXiv 2508.06916）、Proactive Agents for Multi-Turn T2I（arXiv 2412.06771）、Self-Refine（arXiv 2303.17651）、VQAScore、MLLM-as-a-Judge（arXiv 2402.04788）、ImageReward best-of-N（NeurIPS 2023）、promptfoo model-graded metrics（promptfoo.dev）、OTel GenAI semconv（github.com/open-telemetry/semantic-conventions-genai）、Langfuse OTel 集成与自托管（langfuse.com）、W3C traceparent 传播（opentelemetry.io）、RLUF（arXiv 2505.14946）、DSPy GEPA（dspy.ai）、LangGraph memory（docs.langchain.com）、Mem0/Zep/Letta 对比、pgvector vs Qdrant（instaclustr.com）、Postgres RLS 多租户（aws.amazon.com）、ParadeDB 混合检索（paradedb.com）、E2B vs Modal/Firecracker/gVisor/Pyodide（northflank.com、cosmonic.com）。
