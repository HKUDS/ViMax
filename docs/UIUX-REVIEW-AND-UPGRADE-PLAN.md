# ViMax 平台 UI/UX 整体升级方案

> 审查范围：`vimax-platform/apps/web`（Next.js 15 + Tailwind + React Flow）+ `@vimax/ui` 共享组件包
> 审查方式：界面截图走查（画布工作台）+ 前端代码走查（token / 页面 / 组件 / 交互）
> 日期：2026-09-23

---

## 一、总评

**设计基建的底子是好的，问题出在"执行率"和"完成度"。**

`styles/tokens/` 下已经有一套相当专业的设计系统——"Cinematic Studio / Graphite & Tungsten"（石墨中性面 + 钨丝琥珀强调色），双主题、语义色、节点类型色带、字阶、动效时长都有定义。首页也体现了 Cursor × Linear 式的编辑级排版水准（GSAP 入场动效、hairline 卡片、eyebrow 徽章）。

但从首页进入核心创作链路（画布工作台 → AI 助手 → 导出）后，体验出现明显断层：**token 三套命名并存且部分引用了从未定义的变量、画布侧大量绕过组件库本地重造、错误/空态反馈断层、可访问性接近于零、i18n 半途而废**。截图上最直观的后果是：分区标题几乎不可见、左侧节点面板拥挤截断、底部工具栏元素挤作一团、小地图视觉噪音大。

| 维度 | 现状评分 | 目标 |
|---|---|---|
| 视觉语言一致性 | 6/10 | 9 |
| 交互反馈完备度（加载/空/错/进度） | 4/10 | 8.5 |
| 画布工作台体验 | 5/10 | 9 |
| 可访问性 | 2/10 | 7 |
| i18n 完整度 | 4/10 | 9 |
| 组件复用与可维护性 | 5/10 | 8.5 |
| 响应式 | 3/10 | 7 |

---

## 二、核心问题清单（按严重度）

### P0 — 正在造成用户困惑或样式失效

| # | 问题 | 证据 |
|---|---|---|
| 1 | **引用了未定义的 token**：`--color-bg`、`--color-surface-elevated`、`--color-text-secondary/quaternary`、`--color-border-default/hover` 在 colors.css 中并不存在（仅在部分文件里被别处定义过），FlowCanvas、KeyboardShortcuts 等处引用后解析为空值 | `FlowCanvas.tsx:638`、`KeyboardShortcuts.tsx:60`、`assets/page.tsx:41` |
| 2 | **画布节点失败无就地反馈**：失败信息只在右侧 Inspector 里，画布卡片仅有状态字，用户看不到"为什么失败"、无内联重试；自动重试仅 1 次 | `NodeInspector.tsx`（runError/重试）、`useNodeRun.ts` |
| 3 | **分区标题不可见**（截图实证）：Storyline / Storyboard / Production / Assets 分区大字在深色画布上对比度不足，形同隐身 | 截图 + `ZoneBackgroundLayer.tsx` |
| 4 | **AI 助手死交互**：历史会话点击切换的代码被注释，点击只关闭列表；建议 prompts 是静态 span 不可点击 | `ChatPanel.tsx:236-239、266-270` |
| 5 | **探索页整页假数据**：explore 页渲染 `MOCK_ITEMS`，无 loading、无分页，上线形态不可接受 | `explore/page.tsx:21-34` |
| 6 | **粗糙交互残留**：BottomToolbar 用原生 `window.confirm`（项目里明明有 ConfirmDialog）；导出视频失败循环静默吞错 | `BottomToolbar.tsx:191、269-271` |

### P1 — 影响品质感与可维护性

| # | 问题 | 证据 |
|---|---|---|
| 7 | **三套 token 词汇并存**：画布侧 `--color-ink/--color-hairline`、explore/KeyboardShortcuts 用 `--color-text/--color-surface-elevated`、assets 页用 `--color-text-primary/--color-bg-inset`，升级无从下手 | 各页面抽样 |
| 8 | **任意值与硬编码泛滥**：首页 29 处、ChatPanel 23 处、BottomToolbar 13 处 arbitrary class；字号几乎全是 `text-[9px]/[10px]/[11px]` 绕过字阶；CanvasNodes/FlowCanvas/node-visuals 中散落 hex 硬编码 | `app/page.tsx`、`ChatPanel.tsx`、`node-visuals.ts` |
| 9 | **画布工作台硬桌面假设**：NodePalette `w-[152px]`、右栏 `w-[380px]`、BottomToolbar `h-[40px]` 横向溢出无滚动，无任何小屏降级 | `CanvasShell.tsx:100` 等 |
| 10 | **组件库形同虚设（画布侧）**：`@vimax/ui` 有 20+ 组件，但画布侧大量本地重造——TabButton、ghostBtn、分段切换按钮至少 4 处重复实现；NodeInspector/PipelineStepper/CanvasNodes 全用内联 style 对象，与 Tailwind 路线割裂 | `CanvasShell.tsx`、`BottomToolbar.tsx` |
| 11 | **管线进度缺乏总览**：PipelineStepper 有分阶段计数但无总进度条、无 ETA、内联样式 | `PipelineStepper.tsx` |
| 12 | **可访问性近乎为零**：全库 aria/role 仅 2 处；自定义按钮无焦点环（focus-visible 仅 7 个文件）；KeyboardShortcuts 列出的 Ctrl+T/Ctrl+D 多数并未实现，属"展示性清单" | 全库 grep |
| 13 | **i18n 半覆盖**：home/assets/nav 用 next-intl，但约 40 个文件硬编码中文（NodePalette、CanvasShell、WelcomeOverlay 等），中英切换后大量界面仍是中文 | 全库 grep |

### P2 — 锦上添花前应知悉

| # | 问题 |
|---|---|
| 14 | assets 页无错误分支、无分页；explore/assets 各自实现筛选 pill |
| 15 | ChatPanel 状态色语义错位：completed→`--color-ai-generating`、running→`--color-ai-reading`（`ChatPanel.tsx:476-480`） |
| 16 | 动效 token（`--duration-fast/base/slow`）已定义但组件普遍硬编码 `0.2s`，无统一 motion 消费 |
| 17 | 小地图呈现为无意义彩色色块（截图实证），信息价值低、噪音高 |
| 18 | 底部工具栏 6+ 个异质控件（分区、自动排布、深色画布、模型、一键生成、导出）平铺，无主次层级 |
| 19 | AI 助手空态建议语被截断（截图实证），空态文案未做容器适配 |

---

## 三、升级方案

设计总原则延续现有 "Graphite & Tungsten" 语言，**不换风格，治理执行**。升级分五条线推进，可并行。

### 线 1：设计系统治理（解决"从哪改起"）

1. **Token 收敛为一套词汇**：以 `--color-ink / --color-hairline / --color-surface-*`（画布侧新词）为准，把 `--color-text-* / --color-bg-* / --color-border-*` 全部落为 alias 定义在 colors.css（当前部分是"幽灵变量"），或用 codemod 全量替换为标准词。产出：`tokens-audit.md` + 一次全量替换 PR。
   - 验收：`grep -r "var(--color-" | sort -u` 中每个变量都能在 tokens/ 中找到定义。
2. **禁止绕过字阶**：建立 ESLint 规则（或 stylelint）拦截 `text-\[\d+px\]`，收敛到 `--text-caption / --text-micro / --text-body-sm` 三档（9-11px 全部归入 micro/caption，过小的 9px 全站提到 11px 保底可读性）。
3. **Motion token 落地**：所有 `transition-*` 时长统一消费 `--duration-fast/base/slow`；集中定义 3 个缓动曲线（入场、位移、反馈）。
4. **组件库收编**：分段切换按钮（SegmentedControl）、ToolButton、GhostButton、PanelTab 收进 `@vimax/ui`；NodeInspector/PipelineStepper/CanvasNodes 的内联 style 对象分批迁移为 Tailwind class + token。
5. **节点类型色唯一来源**：`node-visuals.ts` 的 8 处 hex 全部改为读取 `--color-node-*`，保证双主题一致。

### 线 2：画布工作台体验升级（核心战斗力）

这是产品主战场，投入优先级最高。

1. **节点状态升级为"可自解释卡片"**：
   - 失败态：卡片底部内联错误摘要条（红底 subtle + 单行错误原因 + "重试 / 查看详情"两个动作），不再强迫用户去 Inspector 找；
   - 运行态：保留顶部光束动画，增加可中断（stop）按钮；
   - dirty 态：虚线边框 + "参数已变更，重新运行"的 hover 提示。
2. **分区标题修复与层级重建**：分区大字改为 `--color-ink-tertiary` 级别的可对比度（暗底上不低于 4.5:1 的 30% 透明度白），加 zone 图标 + 节点计数徽标，hover 时浮现实区边界描边。**这是截图中最刺眼的问题，半天可修。**
3. **底部工具栏重组**：按"视图（左）— 全局操作（中）— 主 CTA（右）"三段式分区，用分隔线分组；"一键生成"保持唯一琥珀色主按钮，导出降为次级；小屏可横向滚动。
4. **管线总进度**：PipelineStepper 顶部加总进度条（script→分镜→镜头→图片→视频→合成 六段），每段显示 done/total，失败段红色可点击跳转对应节点。
5. **小地图降噪**：色块改为按节点状态着色的单色圆点/小方格，隐藏未运行节点的类型色，或提供开关。
6. **连线可读性**：为 edge 增加 hover 高亮与流向动画（运行中的 edge 用 `--color-node-running` 流动虚线），让"数据在流动"可感知。
7. **左栏节点面板**：分组标题（节点模板/节点/资产/片场/后期）加上分区留白与 11px eyebrow 样式，修复文字截断，图标与文字基线对齐。

### 线 3：反馈体系全覆盖（加载/空/错误/进度）

1. **统一四态组件**：`@vimax/ui` 的 SkeletonList / EmptyState / ConfirmDialog / Toast 已存在，立规矩：所有数据页面必须覆盖 loading / empty / error 三态，PR 模板加 checklist。
2. **assets 页**补 error 分支 + 分页（或无限滚动）；**explore 页**先降级为"精选模板 + 指南"静态内容（去掉 MOCK_ITEMS），待社区功能上线再接真数据。
3. **AI 助手盘活**：
   - 恢复历史会话切换（取消注释 + 补全逻辑）；
   - 建议 prompts 改为可点击 chip，点击即填入输入框；
   - 修正状态色语义映射（running→thinking 蓝、completed→done 琥珀）；
   - 空态建议语换为短句 + 完整显示，避免截断。
4. **消灭原生弹窗**：`window.confirm` → ConfirmDialog；导出失败必须有 toast + 重试入口。
5. **全局请求失败兜底**：tRPC 全局 error handler 已处理 401，补充 5xx 的统一 toast 文案与"重试"动作。

### 线 4：可访问性与 i18n（补欠账）

1. **键盘与焦点**：
   - 所有自定义可点击元素补 `focus-visible` 焦点环（统一 `--color-accent-focus` 2px ring）；
   - KeyboardShortcuts 面板与实际实现对账：要么实现 Ctrl+T/Ctrl+D 等列出的快捷键，要么从面板移除；
   - 补齐核心键盘流：Tab 遍历工具栏、Enter 运行选中节点、Del 删除、方向键导航画布（React Flow 自带部分，需接通）。
2. **aria 最低集**：icon-only 按钮（左侧 rail、节点面板、工具栏）必须带 `aria-label`；对话框补 `role="dialog"` + 焦点陷阱（ConfirmDialog 一次性改造）。
3. **i18n 收口**：~40 个硬编码中文文件分两批迁入 next-intl（第一批：画布工作台全部；第二批：面板与浮层）。CI 加检查：`app/`、`features/` 下新增硬编码 CJK 字符串即报错。

### 线 5：响应式最低保障

- 工作台目标定位于桌面创作工具，**不做完整移动端**，但需守住两条底线：
  1. ≥1280px：当前布局不变；
  2. 1024–1280px：NodePalette 可折叠为图标条，右栏面板可收起为侧边抽屉；
  3. <1024px：进入画布时显示"建议使用桌面端"的提示条，其余页面（home/explore/assets/settings）补齐 `sm:/md:` 断点。

---

## 四、实施路线图

| 阶段 | 周期 | 内容 | 出口标准 |
|---|---|---|---|
| **S1 快赢周** | 3-5 天 | 分区标题对比度修复（P0-3）、window.confirm 替换、ChatPanel 死交互盘活 + 状态色修正、空态文案截断修复、幽灵 token 补定义 | 截图走查无隐形元素；画布失败节点可就地重试的雏形 |
| **S2 系统治理** | 1.5 周 | Token 收敛 codemod、字阶 ESLint 规则、组件库收编（SegmentedControl/ToolButton）、node-visuals 色 token 化 | token 审计脚本零悬空引用；画布侧无内联色值 |
| **S3 工作台主升级** | 2 周 | 节点失败内联反馈、底部工具栏三段重组、管线总进度条、edge 流动动画、小地图降噪、左栏面板重构 | 核心链路（创建→生成→失败恢复→导出）全程无死角反馈 |
| **S4 反馈与可达** | 1.5 周 | explore 降级改版、assets 错误态+分页、焦点环 + aria 最低集、i18n 第一批迁移 | 数据页三态全覆盖；键盘可完成核心操作 |
| **S5 打磨** | 1 周 | i18n 第二批、响应式底线、motion token 全量落地、整体视觉回归走查 | Lighthouse a11y ≥ 85；双主题截图走查通过 |

> S1 全部是局部小改，可立即开工；S2 的 token codemod 建议先出 RFC 再动全库；S3 依赖 S2 的组件收编成果。

---

## 五、验收方式（对齐"UI 走查验收"惯例）

1. **每阶段交付后做截图走查**：默认 1440×900 与 1920×1080 双分辨率、双主题各截一轮，重点核对：无截断文本、无不可见元素、无布局挤压。
2. **核心链路手动回归**：登录 → 首页创建（含产品图上传）→ 画布生成 → 人为制造失败 → 内联重试 → 导出视频。
3. **自动化**：token 审计脚本（悬空引用=0）、ESLint 字阶规则、i18n CJK 检查、Lighthouse a11y 基线。

---

## 附：本次审查涉及的关键文件

- 设计 token：`apps/web/src/styles/tokens/{colors,typography,spacing,sizes,radii,shadows}.css`
- 布局：`features/layout/AppLayout.tsx`、`features/canvas/CanvasShell.tsx`
- 画布：`features/canvas/{InfiniteCanvas,ZoneBackgroundLayer}.tsx`、`nodes/CanvasNodes.tsx`、`sidebars/NodePalette.tsx`、`panels/{NodeInspector,VariantGallery,TemplatePicker}.tsx`、`toolbar/BottomToolbar.tsx`、`components/PipelineStepper.tsx`
- AI 助手：`features/chat/ChatPanel.tsx`
- 页面：`app/{page,explore/page,assets/page,studio/image/page,settings/page}.tsx`
- 共享组件：`packages/ui`（Button/Input/EmptyState/SkeletonList/ConfirmDialog/Toast/AppShell 等）
