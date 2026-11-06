# 免费生图/生视频模型方案 Research（FREE-MEDIA-MODELS-RESEARCH）

> **状态**：调研完成；**P0 已落地**（2026-10-25，见 §4 落地记录）
> **日期**：2026-10-25
> **范围**：为 ViMax 生图/生视频链路寻找零成本模型方案——免费 API 渠道（免 GPU）+ 开源自托管（自有 GPU）两条路线；含现状盘点、渠道对比、许可红线、推荐组合与集成路径（P0/P1/P2）。
> **方法**：代码库现状盘点 + 官方定价/限额页与社区实测交叉验证，关键结论附来源（附录 A）。

---

## 0. TL;DR

1. **现状**：已接入的生图/生视频生成器全部走付费渠道（云雾中转 + Google 官方 API），无任何免费层。且 `nanobanana-google` 使用的 `gemini-2.5-flash-image` **已于 2026-10-02 被 Google 关停**，该模型当前实际不可用，P0 必须处理（迁移或下架）。
2. **免费首选（API 免费层，零 GPU）**：**智谱 BigModel 双 Flash**（CogView-4-Flash 生图 + CogVideoX-Flash 生视频，长期免费、OpenAI 兼容、单 key 覆盖图+视频）+ **ModelScope 魔搭 API-Inference**（每日 2000 次刷新额度，Qwen-Image / Wan2.2 全家桶，视频走异步任务）作为主力与兜底。海外兜底：Cloudflare Workers AI（每日 10,000 Neurons，FLUX.1-schnell 生图约 170 张/天；**无视频模型**）。
3. **真·无限免费（自托管 GPU）**：生图 Qwen-Image / Z-Image-Turbo / FLUX.1-schnell（均 Apache-2.0）；生视频 Wan2.2（Apache-2.0，是**最后一代开源旗舰**——Wan2.5/2.6/2.7/3.0 已连续闭源 API-only）。商用许可红线：HunyuanVideo 排除 EU/UK/韩国；LTX-2 营收 ≥$10M 需付费许可；FLUX.2-dev 为非商用 Dev License。
4. **集成成本低**：worker 生成器是 duck-typing Protocol（`generate_single_image` / `generate_single_video`），`handler.py` 按 `class_path` 动态加载。新增免费渠道 = 每渠道 1 个 Python 文件 + `job-types.ts` 注册表条目 + 1 个 env key，P0 一个工作日内可落地。

---

## 1. 代码库现状盘点

- 模型注册表：`packages/contracts/src/job-types.ts` 的 `IMAGE_MODELS`（doubao-seedream-4-0 / nanobanana-google）与视频注册表（doubao-seedance-yunwu / veo-yunwu / veo-google），字段含 `provider`、`class_path`、`init_args`、`credits_per_image`。
- 生成器实现：根目录 `tools/*_api.py`，通过 `vimax_bridge.py` / worker `handler.py`（`importlib` 动态加载 `class_path`，构造注入 `api_key` + `init_args`）调用。
- 全部渠道为付费：云雾中转（Seedream / Seedance / Omni / Veo）与 Google 官方（NanoBanana / Veo）。
- **现网隐患**：`tools/image_generator_nanobanana_google_api.py` 硬编码 `model = "gemini-2.5-flash-image"`（line 22），该模型已于 2026-10-02 shut down；Veo 侧 `veo-3.1-generate-preview` 为付费预览且 Google 免费层无 Veo API 配额。

## 2. 免费 API 渠道对比（免 GPU）

| 渠道 | 生图 | 生视频 | 免费额度 | 调用形态 | 关键限制 |
|---|---|---|---|---|---|
| **智谱 BigModel** | **CogView-3-Flash**（¥0；官方图像 API 枚举的免费档，CogView-4-Flash 未见于官方枚举） | **CogVideoX-Flash**（¥0，T2V+单图 I2V、5s、30/60fps） | **长期免费**（Flash 档） | 生图 `POST /api/paas/v4/images/generations`（同步，返回 30 天临时 URL）；视频 `POST /api/paas/v4/videos/generations` + `GET /api/paas/v4/async-result/{id}` 轮询（SUCCESS/FAIL/PROCESSING） | 免费档并发受限；CogVideoX-3 等正式档 ¥1/次 |
| **ModelScope 魔搭 API-Inference** | Qwen-Image / FLUX.1-schnell / Z-Image 等（OpenAI 兼容 `/v1/images/generations`，返回 url 或 b64_json） | Wan2.1/2.2 等（异步任务） | **每日 2000 次**（所有模型合计；单模型约 500 次/天） | 生图同步已验证；**视频异步端点未在公开文档核实，接入暂缓** | 需绑阿里云账号+实名；并发 1；「体验性质」条款可变 |
| **Cloudflare Workers AI** | FLUX.1-schnell、flux-2-dev/klein 等 | ❌ 无视频生成模型 | **每日 10,000 Neurons**（00:00 UTC 重置，无需信用卡） | 统一 REST `/accounts/{id}/ai/run/@cf/...`；FLUX.1-schnell 计费 4.80 Neurons/512²tile + 9.60/step（1024²·4 步 ≈ 58 Neurons/张 → 约 170 张/天） | 免费量超即停；面向海外网络环境 |
| 阿里云百炼（DashScope） | qwen-image-2.1-pro 等 | wan2.5/2.6/3.0 | 90 天内**一次性**额度（如 qwen-image-2.1-pro 10 张、wan2.6 50 秒） | 异步任务为主 | 只适合 dev 冒烟，不能当产品免费层 |
| Google AI Studio | NanoBanana 系 | Veo | 免费层 2025-12 起大幅缩水（如 2.5 Flash 250→20 RPD）；`gemini-2.5-flash-image` 已关停；**Veo 无免费 API 层**（仅消费级订阅内限量） | genai SDK | 生图需迁移付费 gemini-3 系；不建议再押免费 |
| SiliconFlow 硅基流动 | FLUX.1 ¥0.006/张、Qwen-Image-Edit ¥0.3/张、Z-Image 已上架 | Wan2.2 T2V/I2V 付费 | 生图/视频**无免费**（免费仅小 LLM/BGE rerank，本项目已用） | OpenAI 兼容 | 定位：低价兜底，非免费 |
| Hugging Face Inference Providers | 多 | 少量 | 约 $0.10/月 | REST | 额度过小，仅提及 |

**结论**：国内环境免费主链路 = 智谱（简单、双能力、长期免费）+ 魔搭（量大、模型新、每日刷新）；海外兜底 = Cloudflare（仅生图）。百炼/Google 只做一次性试用，不算免费方案。

## 3. 开源自托管（自有 GPU，额度无上限）

### 3.1 生图（商用宽松许可优先）

| 模型 | 规模 | 许可 | 特点 |
|---|---|---|---|
| **Qwen-Image / Qwen-Image-Edit-2509** | 20B MMDiT | Apache-2.0 | 中文图内文字最强；Edit 2509 支持多参考图（契合电商 SKU 保真） |
| **Z-Image-Turbo** | 6B | Apache-2.0 | 8 步蒸馏、4090 单张秒级，轻量快速 |
| **FLUX.1-schnell** | 12B | Apache-2.0 | 4 步出图，海外生态最广（Cloudflare 亦托管） |
| HiDream-I1 | 17B | MIT | 宽松许可备选 |
| SD 3.5 | 2-8B | 社区许可（营收 <$1M 免费） | 老牌生态 |
| FLUX.2-dev | 32B | Dev License（**非商用**） | 能力强但不可作商用默认 |

### 3.2 生视频

| 模型 | 规模 | 许可 | 特点 |
|---|---|---|---|
| **Wan2.2-T2V/I2V-A14B / TI2V-5B** | MoE 14B 激活 / 5B | **Apache-2.0** | 最后一代开源 Wan 旗舰（2.5/2.6/2.7/3.0 连续闭源）；TI2V-5B 统一 T2V+I2V，4090 可跑 720P/24fps——**最契合 ViMax 图→视频链路** |
| HunyuanVideo 1.5 | 8.3B | 腾讯社区许可 | 14GB 显存可跑、质量高；**排除 EU/UK/韩国地域** |
| LTX-2 / LTX-2.5 | 13B+ | LTX 社区许可 | 速度快、实时向；**营收 ≥$10M 需付费许可** |
| CogVideoX1.5 / Mochi-1 | 5B / 10B | Apache 系 | 轻量备选 |

- 低显存加速：FramePack（消费级显卡 I2V 长视频）、LightX2V。
- 运行载体：**ComfyUI**（生产工作流、可编排多模型）或 diffusers 进程内；ViMax worker 以 REST 桥接 ComfyUI 即可复用现有 Protocol。

### 3.3 许可红线（自托管商用）

自托管默认只装 Apache-2.0 组合：生图 Qwen-Image/Z-Image-Turbo/FLUX.1-schnell + 生视频 Wan2.2。HunyuanVideo（地域）、LTX-2（营收门槛）、FLUX.2-dev（非商用）仅在明确合规评估后引入。

## 4. 推荐方案与集成路径

### P0 — 免费层落地（约 1 人日）✅ 已落地（2026-10-25）

1. ~~智谱双 Flash 生成器~~ **已落地**：`tools/image_generator_cogview_zhipu_api.py`（cogview-3-flash，尺寸自动吸附到官方允许集）+ `tools/video_generator_cogvideox_zhipu_api.py`（cogvideox-flash，提交+轮询，首帧图走 base64 `image_url`）；注册 contracts preset：`cogview-3-flash` / `cogvideox-flash`（`provider: "zhipu"`、credits=0）。env：`ZHIPU_API_KEY`。
2. ~~魔搭生成器~~ **生图已落地**：`tools/image_generator_modelscope_api.py`（`/v1/images/generations`，url/b64 双分支），preset `modelscope-qwen-image`，env `MODELSCOPE_API_TOKEN`。**视频暂缓**：异步端点未在公开文档核实，不臆造接口。
3. **默认模型切换**：`DEFAULT_IMAGE_MODEL` / `DEFAULT_VIDEO_MODEL`（API 侧，作用于 resolveImageModel/resolveVideoModel 与 pipeline-orchestrator）+ `NEXT_PUBLIC_DEFAULT_IMAGE_MODEL` / `NEXT_PUBLIC_DEFAULT_VIDEO_MODEL`（Web 侧默认选中）；key 注入改为 provider 感知（`config.apiKeyFor(provider)`：zhipu/modelscope 各取所需，默认 ARK）。
4. **模型列表合并**：`model.listImageModels/listVideoModels` 在 DB 行之后追加未收录的 contracts preset——免费模型无需迁移即可在选择器出现；smoke 套件 S13 优先免费档并新增 S13b 真实 t2v（cogvideox-flash）。
5. **nanobanana-google 迁移**：仍待办（`gemini-2.5-flash-image` 已关停）——本地免费链路不再依赖它，迁移目标 gemini-3 系为付费，单独排期。

免费链路启动方式：`.env` 配 `ZHIPU_API_KEY`（+可选 `MODELSCOPE_API_TOKEN`）、`DEFAULT_IMAGE_MODEL=cogview-3-flash`、`DEFAULT_VIDEO_MODEL=cogvideox-flash`、Web 侧 `NEXT_PUBLIC_DEFAULT_*` 同值，重启 api/web/worker 即可；冒烟验证 `export ZHIPU_API_KEY=... && pnpm --filter @vimax/api smoke`（S13/S13b）。

**端到端验证（2026-10-26，本地实测）**：smoke 17 步 16 过——S13 免费生图（CogView-3-Flash，~300KB PNG）与 S13b 免费生视频（CogVideoX-Flash，~677KB MP4）全链路（API→bridge→worker→智谱→MinIO→presigned URL）打通。过程中修复三个现网问题：① contracts `VideoJobPayloadSchema.job_type` 只允许 `shot.video`，studio 的 `video.t2v/i2v` 在 bridge 被 Zod 拒收丢弃（已扩枚举并补 `aspect_ratio/fps` 字段）；② smoke S10 命中历史缓存对象（二进制已被 24h TTL 清扫 → presigned GET 404 NoSuchKey），S08 源图已改为每轮唯一；③ 免费档视频高峰 429 限流（1305），生成器提交重试已按轮询间隔退避。遗留：S14 Chat Agent 依赖的默认文本模型（deepkey 中转）上游不可达；智谱 key 调对话模型报 1113（无资源包/余额）——免费生图视频不受影响。

**i2i 免费档落地（2026-10-26）**：魔搭 **Qwen-Image-Edit-2509**（多参考图编辑，1-3 张）接入为 `modelscope-qwen-image-edit` preset（`supports_reference: true`、credits=0），生成器 `tools/image_generator_qwen_image_edit_modelscope_api.py`——异步任务流（提交带 `X-ModelScope-Async-Mode: true` → 轮询 `GET /v1/tasks/{id}` 需带 `X-ModelScope-Task-Type: image_generation`，成功取 `output_images[0]`），参考图以 base64 data URI 走 `images` 参数（参数表见[魔搭 API 教程](https://zhuanlan.zhihu.com/p/1974160423860318947)；⚠️ base64 传参仅有参数表佐证、无官方代码示例，首个 token 实测时若被拒可改走 `image_url` + 临时图床之外的自托管图床方案）。新增 env `DEFAULT_I2I_IMAGE_MODEL`：`resolveImageModelForMode` 在 i2i（带参考图/编辑）且所选模型不支持时自动回退（cogview-3-flash → qwen-image-edit），t2i 不受影响；接入点：画布 image 节点/变体/编辑、分镜首帧（shot.first_frame，原先静默丢参考图）、studio generate/edit。

### P1 — 额度感知调度

- 降级链：zhipu → modelscope → cloudflare（海外）→ 付费渠道；识别 429/403「额度耗尽」标记 retryable 并切换渠道（复用 worker 现有 retryable 语义）。
- 魔搭单模型 ~500 次/天上限 → 同类模型轮换（Qwen-Image ⇄ FLUX.1-schnell ⇄ Z-Image）。
- Studio 模型卡用 `credits_per_image: 0` 标记免费档，前端可显式引导。

### P2 — 自托管后端（真·免费、无限量）

- 新增 `tools/image_generator_comfyui_api.py` / `tools/video_generator_comfyui_api.py`，默认工作流 Qwen-Image + Wan2.2-TI2V-5B（全 Apache-2.0）；适合 dev/内网/私有化部署场景。

## 5. 风险与注意

1. **免费条款随时可变**：魔搭「体验性质」、智谱免费档并发、Cloudflare Neurons 政策均可能调整，建议每季度复核附录来源。
2. **实名与合规**：魔搭需阿里云实名；不建议多账号轮换绕额度（违反 ToS）。
3. **视频异步时延**：免费档视频普遍 1-5 分钟/条且并发 1，批量任务需排队与进度回传（现有 job progress 事件可承载）。
4. **商用许可**：闭源免费 API（CogVideoX-Flash 等）用于商业产品需确认平台条款；自托管侧坚持 Apache-2.0 组合最稳。

---

## 附录 A：来源

- Gemini API 定价/限额（gemini-2.5-flash-image 弃用、免费层缩水、Veo 无免费 API）：[pricing](https://ai.google.dev/gemini-api/docs/pricing)、[rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)、[AtlasCloud 分析](https://www.atlascloud.ai/blog/tips/veo-3.1-ai-video-generator-free-or-paid)
- 智谱免费模型：[CogVideoX-Flash（免费）](https://docs.bigmodel.cn/cn/guide/models/free/cogvideox-flash)、[CogVideoX-3（¥1/次）](https://docs.bigmodel.cn/cn/guide/models/video-generation/cogvideox-3)、[API 定价](https://docs.bigmodel.cn/cn/guide/start/pricing)
- 魔搭每日 2000 次免费与单模型限额：[官方 limits](https://www.modelscope.ai/docs/model-service/API-Inference/limits)、[实测文章（2026-01）](https://zhuanlan.zhihu.com/p/1996869640102626604)、[Agent 工作流接入（2026-06）](https://x.com/cgnot996/article/2071423601564344322)
- Cloudflare Workers AI 免费额度与 FLUX.1-schnell 计价：[官方 pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- 阿里云百炼免费额度（90 天一次性）与模型价格：[模型调用价格](https://help.aliyun.com/zh/model-studio/model-pricing)、[万相视频 API](https://www.alibabacloud.com/help/zh/model-studio/image-to-video-general-api-reference)
- SiliconFlow 生图/视频收费与免费范围：[价格页](https://www.siliconflow.cn/pricing)、[Wan2.2 上线公告](https://zhuanlan.zhihu.com/p/1940738220678715328)、[Qwen-Image-Edit 上线](https://www.53ai.com/news/OpenSourceLLM/2025091980563.html)
- 开源视频模型许可格局（Wan2.2 为最后一代 Apache 旗舰；HunyuanVideo 1.5 社区许可；LTX-2 社区许可 $10M 门槛）：[AtlasCloud：Wan 3.0 是否开源](https://www.atlascloud.ai/zh/blog/tips/is-wan-3.0-open-source)、[Tencent-Hunyuan/HunyuanVideo-1.5 LICENSE](https://github.com/Tencent-Hunyuan/HunyuanVideo-1.5/blob/main/LICENSE)、[LTX 商业许可](https://ltx.io/model/license)、[Artificial Analysis：Wan2.2 A14B](https://x.com/ArtificialAnlys/status/1951391812280848887)、[2026 开源视频模型综述](https://ltx.io/blog/open-source-video-generation-models-guide)
- Wan2.2 / Qwen-Image 模型页：[Wan2.2-T2V-A14B](https://www.modelscope.ai/models/Wan-AI/Wan2.2-T2V-A14B-BF16)、[万相 2.2 合集](https://www.modelscope.cn/collections/tongyiwanxiang-22--shipinshengcheng-2bb5b1adef2840)
