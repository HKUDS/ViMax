# 提示词「联想词」+「限制词」板块调研分析报告

> 状态：P0 已实现（commit 1bba7f0，2026-09-24）；P1/P2 待排期
> 日期：2026-09-24
> 范围：需求定义、业界调研、平台现状 Gap 分析、接入规格、分期实施方案

---

## 1. 需求定义

在提示词输入环节新增两个板块：

- **联想词（延伸词/联想词）**：辅助用户扩写提示词。按维度（运镜/灯光/风格质感/情绪氛围/画质增强/主体细节）提供可点选的词条，点击追加进 prompt；进阶形态为输入时自动补全与 LLM 智能扩写。
- **限制词（负面提示词）**：声明"画面中不希望出现什么"。以分组预设词条（画质/水印文字/解剖/视频时序）+ 自由输入的方式管理，随 prompt 下发到生成链路。

两个板块覆盖所有提示词入口：首页 prompt 卡片、image studio、video studio、画布节点检查器、自动管线。

## 2. 业界调研

### 2.1 限制词：模型支持度是第一约束

| 模型/平台 | 独立负面词参数 | 结论 |
|---|---|---|
| SD / Flux 系（本地 ComfyUI/WebUI） | ✅ 原生 negative prompt 通道 | 我们不走本地 SD，不适用 |
| **字节系 Seedream（生图）** | ❌ API 无该参数 | 官方提示词指南只讲正向写法；建议把"不要 X"转成正向描述 |
| **字节系 Seedance（生视频）** | ❌ 基本不读负面词 | 社区实测"写了 Negative Prompt 等于白写，需翻转为正向描述"；不支持权重语法 `(masterpiece:1.5)` |
| Veo 系 | ⚠️ 自然语言负提示 | 以自然语言描述排除项（如"不含城市背景"），无 SD 式独立通道 |

**对本平台的含义**：生成后端全部是云 API（豆包 Seedream/Seedance、Veo、NanoBanana，经 yunwu 代理），负面词**只能以文本形式折叠进 prompt**——现有 `composeVideoPrompt` 的 `Avoid: ${negativePrompt}` 策略是对的，图片侧对齐即可。措辞保持自然语言，禁用 SD 权重语法。

成熟预设词库高度收敛为四组（各指南一致）：

| 分组 | 代表词条 | 适用 |
|---|---|---|
| 通用画质 | low quality, blurry, low res, jpeg artifacts, worst quality | 图+视频 |
| 水印文字 | watermark, text, logo, signature, username | 图+视频 |
| 解剖/手部 | bad hands, extra fingers, fused fingers, deformed anatomy | 图为主 |
| 视频时序 | warping, morphing, flickering, jittery, distorted faces, inconsistent character | 视频专属 |

最佳实践：具体优于笼统；**按需勾选、不整包堆砌**；视频与图像负面词分库。

### 2.2 联想词：三种业界形态，对应三个优先级

| 形态 | 代表 | 交互 | 对我们的适配度 |
|---|---|---|---|
| ① 点击式预设词条 | Promptalot 卡片库（3500+ 词，搜索+点选）、即梦工作流模板 | 维度分组 chips，点击追加/填入 | **首选**。video studio `INSPIRATION_PRESETS`、首页 `GOALS` 已验证同款交互，零新增依赖 |
| ② 输入时标签自动补全 | a1111 tagcomplete / ComfyUI 生态（Danbooru 词库 + 前缀模糊匹配 + 中文翻译） | 敲词弹联想，回车上屏 | P1。无 cmdk/tag-input 依赖，需自建轻量组件（`@vimax/ui` Badge 可作 chip 视觉） |
| ③ LLM 智能扩写/润色 | 即梦提示词优化、阿里云 Prompt 扩写、Midjourney describe（逆向） | 一键"AI 扩写" | P2。效果最好但有 LLM 成本与延迟，挂决策层 `enhance_prompt` 工具 |

另参考优设《AI 产品提高提示词输入效率的 8 种设计方法》：关键词匹配、AI 润色、推荐常用词、保存常用词、逆向生成、表单化选择等——本方案 P0 覆盖其中"推荐常用词 + 表单化选择"，P2 覆盖"AI 润色"。

## 3. 平台现状盘点（Gap 分析）

### 3.1 可直接复用的资产

| 能力 | 位置 | 复用方式 |
|---|---|---|
| 预设词库机制 | `packages/contracts/src/job-types.ts`（`VIDEO_STYLE_PRESETS`/`VIDEO_MOTION_PRESETS`/`VIDEO_ASPECT_RATIOS`）、`canvas-types.ts`（灯光词库、`IMAGE_KIND_PRESETS`、电商场景） | 结构统一 `{id, label, prompt 片段}`，新词库照抄 |
| 视频负面词全链路 | `VideoGenerateInputSchema.negative_prompt` → `composeVideoPrompt` 折叠 `Avoid:` → worker 文本透传 | 图片侧逐层对齐 |
| 点击填词交互范式 | video studio `INSPIRATION_PRESETS`（L59-94）、首页 `GOALS`（L52-59） | 联想词 chips 直接仿写 |
| 负面词 UI 抽屉 | video studio L508-531 折叠抽屉 + i18n key（`negativeLabel`/`negativePlaceholder` 已有） | image studio 抄过来 |
| 画布字段渲染 | `NodeInspector` 泛型字段渲染器 + `FIELD_LABELS` 已含 `negativePrompt: "负向词"` | 节点默认 data 补 key 即自动出编辑框 |
| 节点数据定义 | `ImageNodeData.negativePrompt`（canvas-types L122）、`runVideoNode` 已消费 `Avoid:`（node-executor L1099） | 字段已备好，图片侧接线即可 |
| JSONB 存储 + 缓存 | prompt 存 `jobs.input_snapshot` / `canvas_nodes.data` JSONB；`buildVideoCacheKey` 含合成后 prompt | 加字段**零 DB 迁移**，负面词变化自动绕缓存 |
| skill 词库 | `data/skills/art/*.md` 11 个美术风格，frontmatter 带 prompt 模板 | P2 注入 compose 链路（当前是死数据） |

### 3.2 空白点

- 图片链路无负面词：`ImageGenerateInputSchema`、`ImageJobPayloadSchema.input`、`composeImagePrompt` 三处均无；`runImageNode`/`runVariants`/`runShotNode` 不消费 `negativePrompt`。
- image studio 全站最简陋：无负面词、无灵感词、无风格预设。
- 首页 prompt 卡片为裸 textarea，无任何词条辅助。
- 画布 image/video 节点默认 data（`node-defaults.ts`）无 `negativePrompt` key，NodeInspector 标签备好了却不显示。
- 决策层无 `enhance_prompt` 工具；websocket turnPrompt 指令规定 image 节点只带 prompt/size。
- 无统一联想词库：灵感词/风格词散落在各页面组件内，无法跨页复用。

## 4. 接入规格

### 板块 B：限制词

| ID | 需求 | 说明 |
|---|---|---|
| FR-N1 | 契约扩展 | `ImageGenerateInputSchema`、`ImageJobPayloadSchema.input` 增加可选 `negative_prompt`；`composeImagePrompt(data)` 拼接 `Avoid: ${negativePrompt}`，与 `composeVideoPrompt` 对齐；worker 零改动 |
| FR-N2 | 预设词库 | contracts 新增 `NEGATIVE_PROMPT_PRESETS`：四分组（通用画质/水印文字/解剖/视频时序），词条中英双语，标注"视频时序"组仅视频入口展示 |
| FR-N3 | image studio | 补负面词折叠抽屉（仿 video studio）+ 预设 chips 多选 + 自由输入，提交走 `negative_prompt` |
| FR-N4 | video studio | 现有单行 input 升级为同款 chips + 预设（行为不变，仅交互升级） |
| FR-N5 | 画布节点 | `node-defaults.ts` image/video 默认 data 加 `negativePrompt: ""`；`runImageNode`/`runVariants`/`runShotNode` 三处消费；NodeInspector 自动出编辑框（P1 换专用 TagInput） |
| FR-N6 | 自动管线 | pipeline-orchestrator 自动建 image/video 节点时注入温和默认负面词（画质+水印组）；websocket turnPrompt 放开允许 agent 带 `negativePrompt` |

### 板块 A：联想词

| ID | 需求 | 说明 |
|---|---|---|
| FR-A1 | 统一词库 | contracts 新增 `PROMPT_THESAURUS`，照 `VIDEO_STYLE_PRESETS` 结构，维度分组：运镜（映射 motion presets）、灯光（复用现有灯光词库）、风格质感、情绪氛围、画质增强、主体细节；中英双语（中文标签 + 英文 prompt 片段） |
| FR-A2 | 首页卡片 | prompt 卡片下方增加维度 tab + 词条 chips，点击**追加**到 prompt（不覆盖已输入内容） |
| FR-A3 | image studio | 补联想词 chips（与 FR-A1 同库）；顺带补风格预设，消除与 video studio 的体验差 |
| FR-A4 | 输入自动补全（P1） | textarea 敲词对本地词库做前缀匹配弹联想，自建轻量组件，无新增依赖 |
| FR-A5 | LLM 扩写（P2） | 决策层注册 `enhance_prompt` 工具（AGENT_TOOLS + executeToolCall + 系统提示词三处小改）；激活 skill 时把 frontmatter prompt 模板注入 `composeImagePrompt` |

### 边界（不做）

- 不引入 Danbooru 等外部词库/在线 autocomplete API（平台以影视级写实创作为主，动漫 tag 语料不匹配，且引入网络依赖）。
- 不做 SD 权重语法（`(word:1.5)`）——底层云 API 全部不支持。
- 不做按 provider 分策略下发（统一 `Avoid:` 文本折叠；字节系负面词实效有限属已知局限，词库注释中说明）。
- 不做负面词的 DB 独立列/用户级持久词库（JSONB 已够；"保存常用词"后置）。

## 5. 分期实施 Plan

| 期 | 内容 | 规模 |
|---|---|---|
| **P0** | FR-N1/N2/N3/N5（defaults 部分）+ FR-A1/A2/A3：契约字段 + 两个词库 + image studio 负面词抽屉与预设 + 首页/image studio 联想 chips | 一个 PR，约 1 天 |
| **P1** | FR-N4/N5（TagInput）/N6 + FR-A4：video studio chips 升级、NodeInspector 专用 TagInput、管线/决策层注入默认负面词、输入自动补全 | 一个 PR |
| **P2** | FR-A5：`enhance_prompt` LLM 扩写 + skill 词库注入 compose 链路 | 独立评审后实施 |

### 测试（TDD）

- contracts 单测：`composeImagePrompt` 含/不含 `negativePrompt` 两种输入的输出快照（与 `composeVideoPrompt` 用例对齐）；zod schema 解析用例（字段可选、空串容忍）。
- web 冒烟：image studio 负面词抽屉开合、chips 勾选反映到提交 payload；首页 chips 追加不覆盖已有输入。

## 6. 验收标准

- [x] image studio 提交带负面词的生图任务，prompt 尾部出现 `Avoid: ...`（单测：composeImagePrompt 折叠顺序与空值分支）
- [x] 负面词变化改变合成后 prompt，从而改变缓存键（单测：notEqual 断言）
- [x] 首页/image studio 点联想词只追加不覆盖（组件以 `, ` 拼接当前值）
- [x] video studio 负面词升级后提交行为不变（payload 字段与 handler 未动，API 146 项全过）
- [x] 全链路无 DB 迁移、无 worker 改动、无新增前端依赖（diff 范围确认）
- [ ] 浏览器端冒烟（chips 交互、抽屉开合、真实出图）——待联调环境验证

## 7. 风险与已知局限

| 风险 | 说明 | 缓解 |
|---|---|---|
| 字节系模型负面词实效有限 | Seedance 基本不读负面词，`Avoid:` 折叠对它近似安慰剂 | 预设组偏"正向可翻转"措辞倾向；文档与词库注释明示局限，避免用户过度依赖 |
| 联想词追加导致 prompt 超长 | 云 API 对超长 prompt 有截断风险 | chips 追加时给出长度提示（复用 video studio token 计数）；单维度词条保持短片段 |
| 词库双份维护 | 各页面若各自拷贝词库会漂移 | 词库唯一来源 contracts，页面只消费 |

## 8. Plan 输入

P0 落地顺序：contracts（schema + `composeImagePrompt` + 两个词库）→ contracts 单测 → web（image studio 抽屉与 chips、首页 chips、node-defaults）→ 冒烟自测。P1/P2 依评审结论排期。

## 参考来源

- [a1111-sd-webui-tagcomplete（Danbooru 标签自动补全）](https://github.com/DominikDoom/a1111-sd-webui-tagcomplete)
- [Atlas Cloud：Seedream 5.0 Pro 提示指南（负面词不支持独立参数）](https://www.atlascloud.ai)
- [火山方舟：Seedream 4.0-5.0 提示词指南](https://www.volcengine.com)
- [知乎：Seedance 2.0 提示词攻略（不读负面词，需翻转正向）](https://zhuanlan.zhihu.com)
- [优设：AI 产品提高提示词输入效率的 8 种设计方法](https://www.uisdc.com/)
- [Google：视频生成提示指南（Veo 自然语言负提示）](https://docs.cloud.google.com/gemini)
