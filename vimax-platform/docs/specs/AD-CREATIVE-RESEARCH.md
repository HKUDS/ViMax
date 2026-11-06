# 广告创意工具调研（AD-CREATIVE-RESEARCH）

> 目标：让用户"没有太多心智负担地做创意广告"。本文档回答两个问题——
> ① 成熟的 AI 广告工具都做对了什么；② 广告脚本的方法论骨架是什么。
> 结论直接落到实现：`packages/contracts/src/ad-creative.ts`（结构预设）
> + 决策层 `create_ad` 工具 + 广告工作流模板。

## 1. 竞品格局：广告专用工具 vs 通用视频工具

| 工具 | 核心广告能力 | 对本项目的启示 |
|---|---|---|
| Creatify | **商品 URL→广告**：抓取商品图/描述/价格，自动组装 15s 口播广告；同一商品批量生成 5–10 个不同 hook/CTA 变体 | 商品信息→广告脚本的一步化；hook 变体批量生成（A/B 测试是广告刚需） |
| HeyGen | Video Agent：一句 prompt→脚本+分镜+数字人→成片（<4 分钟）；多语言配音 | 对话式一站式；口播是人货场核心 |
| Arcads | UGC 素人 口播视频；CSV 批量跨数十个演员生成 | "素人感">精致感（信息流广告的共识）；批量变体 |
| InVideo AI | prompt→成片，**文本迭代**（"开头更急迫一点""换成特写"） | 对话式返工是低心智负担的关键交互 |
| Pencil | 预测性评分（CTR 预估排序创意） | 数据层，后期再做 |
| AdCreative.ai | Veo+Sora 捆绑、AI 音乐（版权已解）、字幕、时间线 | 最后一公里：字幕+音乐 |
| CapCut Commerce Pro | 自动字幕、精剪 | 字幕是投放硬需求 |
| Google Veo (Ads Asset Studio) | 商品照片+3 句描述→15s 广告（90 秒内出片） | 输入极简：商品图+几句话就够 |

**共识结论**：广告工具区别于通用视频工具的五件事——
① 商品/品牌资料一键进场；② 脚本遵循广告结构（hook→痛点→方案→CTA）而非影视结构；
③ **同一素材批量产 hook/CTA 变体**供投放 A/B；④ 平台规格预设（9:16/1:1/16:9）+ 字幕；
⑤ 口播（数字人/UGC 素人）是默认形态。

## 2. 广告脚本方法论骨架

### 2.1 时间轴结构（DR 直效公式，业界收敛的形态）

```
[0–3s]   HOOK      黄金3秒：滚动决策约 1.5s 内发生，72% 用户 3 秒内划走
[3–8s]   PAIN      痛点+激化（Agitate）：让问题变得紧迫、情绪化
[8–20s]  SOLUTION  产品演示 + 价值主张 + 信任背书（销量/成分/见证）
[最后3-5s] CTA      唯一、明确的行动指令
```

- 完整 PAS 结构适合 30s+；**15s 广告收缩为 Hook → Solution → CTA**。
- 抖音官方创意准则：前 3 秒给内容主张，前 6 秒强化 hook；算法权重看**完播率**（15s 75% 完播 > 30s 40%）。
- 一条广告 = 一个信息 = 一个动作（one ad, one message, one action）。

### 2.2 Hook 类型库（中文网感归纳）

| 类型 | 句式模板 | 适用 |
|---|---|---|
| 痛点提问 | "还在为___烦恼？" "___不敢___怎么办？" | 通用，痛点越具体越准 |
| 反常识 | "别再___了，其实___才是真相" | 认知差强的品类 |
| 效果前置 | 前 3 秒直接展示使用后的结果/获得感 | 美妆、改造类 |
| 身份认同 | "如果你也是___，这条视频别划走" | 人群精准的品类 |
| 放大焦虑 | "目标还没达成 + 不可控感" | 教育、理财（慎用） |
| 悬念冲突 | 最炸裂的冲突/颠覆开场 | 短剧带货 |

### 2.3 CTA 与钩子的呼应

- 痛点型钩子 → "点击下方链接领取解决方案"；效果前置 → "同款链接在下方"；限定型 → "今天下单立减"。
- CTA 短、动作明确、画面居中（避开平台 UI 遮挡区）。

### 2.4 平台规格

- 抖音/Reels/TikTok：9:16，15–30s，原生素人感优先于精致感。
- Meta 信息流：1:1 / 4:5；YouTube：16:9。
- 前 3 秒必须有字幕（大量用户静音刷）。

## 3. 落地设计（本项目的实现映射）

### 3.1 契约层 `ad-creative.ts`（词条单一来源，仿 prompt-words 模式）

- `AD_DURATION_PRESETS`：15s / 30s / 60s（含各段拍数建议）。
- `AD_HOOK_TYPES`：痛点提问 / 反常识 / 效果前置 / 身份认同 / 悬念冲突（含中文句式模板）。
- `AD_CTA_TYPES`：限时优惠 / 点击了解 / 立即购买 / 关注账号。
- `AD_PLATFORM_PRESETS`：复用现有 `VIDEO_ASPECT_RATIOS`，映射画幅。
- `AD_SCRIPT_BEATS`：hook / pain / solution / proof / cta 五拍结构定义。
- `buildAdScriptPrompt(input)`：把 商品描述+卖点+受众+时长+hook 类型 组装成结构化生成 prompt（输出分拍广告脚本，每拍带画面描述，可直接喂给 script→分镜链）。
- `parseAdScript` / `AdScript` 类型：五拍解析，容错。

### 3.2 决策层 `create_ad` 工具

- 输入：`product_description`（必填）、`selling_points?`、`audience?`、`duration?`（15/30/60）、`hook_type?`、`style?`。
- 行为：调 `buildAdScriptPrompt` 生成**分拍广告脚本**（每拍=镜头级画面描述+口播文案）→ 写入 script 节点（内容为可直接分镜的结构）→ 提示用户可一键跑全自动管线。
- `DECISION_SYSTEM_PROMPT` 增加"广告创作"工作流：识别广告意图 → create_ad → 分镜 → 一键管线。

### 3.3 广告工作流模板（workflow-templates）

复用现有 copy-driven 模式（编排器注释里"广告/短剧默认走文案驱动"已存在）：

- `ad-ugc-15s`：15s UGC 口播带货（商品图 → hook 口播 → 产品特写 → CTA）。
- `ad-feature-demo`：产品功能演示（商品图 → 场景痛点 → 功能演示镜头 → CTA）。
- `ad-comparison`：痛点对比种草（前后对比双镜头 → 产品露出 → 见证 → CTA）。

### 3.4 最后一公里（第二批已实现）

- **口播 TTS**：`tools/tts_generator_openai_api.py`（OpenAI 兼容 `/v1/audio/speech`，yunwu 可用）；`audio.tts` job type + 音频 worker 真实分流（`audio.generate` 仍为静音占位）；镜头执行器 `runVoiceover`（voiceoverText 优先，回退 audioDesc），完成后回填 `data.voiceoverAssetId`，不触发视觉级联。模型走 `Settings > Models` 的 tts 类型（有内置 fallback 描述符）。
- **字幕烧录**：concat worker 支持 `input.subtitles`（与片段对齐的文本数组），ffprobe 取真实时长构建 SRT，ffmpeg subtitles 滤镜重编码烧录；Dockerfile 安装 `fonts-noto-cjk`，可用 `SUBTITLE_FONT` 覆盖。concat 节点 `data.burnSubtitles: true` 即自动收集上游 shot 的口播做字幕；字幕参与内容缓存键。纯函数 `buildSrt` / `wrapSubtitleLine`（contracts）可用于导出 .srt。
- **钩子变体批量**：`runAdVariants(canvasId, nodeId, {hookTypes?, count?})` —— 一次 LLM 调用产出 N 个变体脚本节点（isAd + adBrief 标注钩子类型），与源节点共同接入自动管线；决策层工具 `create_ad_variants` + tRPC `canvas.runAdVariants`。
- **商品 URL 抓取（合规实现）**：`domain/ad/product-url.ts` —— 仅在用户主动提交 URL 时单次抓取公开页，只解析 Open Graph / JSON-LD Product 元数据，不绕过登录墙/反爬，失败即回退手动输入；SSRF 防护（协议白名单、DNS 解析全记录私网校验、IPv4-mapped IPv6 fail-closed、≤3 跳重定向逐跳复检、2MB 上限）。决策层工具 `extract_product` + tRPC `canvas.extractProduct`。

### 3.5 仍不做

- 数字人口播（需形象资产授权链路）。
- 预测性评分（需要投放数据回流）。
- 反爬规避/登录态抓取（合规红线，永不做的排除项）。

## 4. 参考来源

- [Best AI Video Generator for Ads in 2026 (HeyGen)](https://www.heygen.com/blog/best-ai-video-generator-for-ads)
- [Best AI Ad Generators in 2026: 7 Tools Compared (Zeely)](https://zeely.ai/blog/best-ai-ad-generators)
- [How to Create UGC Ads at Scale (Admove)](https://www.admove.ai/blog/how-to-create-ugc-ads)
- [How to Write UGC Scripts for Ads That Convert (Motion)](https://motionapp.com/blog/how-to-write-ugc-ad-scripts)
- [TikTok 官方创意最佳实践](https://ads.tiktok.com)
- [抖音短视频十大钩子开头，黄金3秒](https://www.ixunke.com/article/562)
- [9个爆款钩子开头万能公式（知乎）](https://zhuanlan.zhihu.com/p/696350327)
- [AIDA 与 PAS 框架速查](https://www.threads.com/@accupass/post/DPS5gKlkebb)
- [短影音行銷 5 種萬用腳本](https://www.yclive.com.tw/5universalscript)
- [CTA 类型与最佳实践](https://payproglobal.com/zh/%E8%A7%A3%E7%AD%94/%E4%BB%80%E4%B9%88%E6%98%AF%E8%A1%8C%E5%8A%A8%E5%8F%B7%E5%8F%AC-cta)
