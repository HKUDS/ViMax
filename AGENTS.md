# ViMax Platform — Agent Architecture

## 决策层（唯一实现）

Web 平台的 AI 对话与工具编排由 TypeScript 实现：

- `vimax-platform/apps/api/src/domain/agent/decision-layer.ts` — 决策 Agent、工具定义与执行
- `vimax-platform/apps/api/src/realtime/websocket.ts` — Chat WebSocket 入口（`chat.send` / `chat.stop`）
- `vimax-platform/apps/api/src/domain/canvas/pipeline-orchestrator.ts` — 全自动管线编排（script→分镜→镜头→图片→视频→合成）

## Python ViMax 集成（全量 Agent 桥接）

仓库根目录的 HKUDS/ViMax 多智能体框架通过 **Worker 桥接**调用，不作为独立 HTTP 服务。编排权始终在 TS orchestrator，每个 Python Agent 是一个原子 job type：

- `vimax-platform/workers/image/vimax_image_worker/vimax_bridge.py` — Agent 桥接层（挂载 `VIMAX_ROOT`，13 个 Agent 全量接入）
- `vimax-platform/workers/image/vimax_image_worker/pipeline_handler.py` — job_type → bridge dispatch 表（`PIPELINE_JOB_HANDLERS`）
- `apps/api/src/domain/canvas/agent-result.ts` — 完成侧：把 JSON result 映射回画布（角色/剧本/选优/机位树/三视图）

Agent ↔ job type 对照（`packages/contracts/src/job-types.ts` `PIPELINE_JOB_TYPES`）：

| Agent | job type |
|---|---|
| StoryboardArtist | `pipeline.script2storyboard` / `pipeline.story_push`（配合 ScriptPlanner） |
| Screenwriter | `pipeline.idea2script` |
| CharacterExtractor | `pipeline.script2characters` |
| CharacterPortraitsGenerator | `pipeline.character_portraits` |
| CameraImageGenerator | `pipeline.camera_tree` |
| ReferenceImageSelector | `pipeline.select_reference` |
| BestImageSelector | `pipeline.select_best_image` |
| ScriptPlanner / ScriptEnhancer | `pipeline.plan_script` / `pipeline.enhance_script` |
| NovelCompressor + EventExtractor + SceneExtractor + GlobalInformationPlanner | `pipeline.novel2scenes` |

注意：`ScriptPlanner`/`ScriptEnhancer`/`BestImageSelector` 上游未在 `agents/__init__.py` 导出，桥接层一律从子模块导入。

## 标准生产路径

```
输入(创意/剧本) → Chat Agent → script 节点
  → [全自动] pipeline-orchestrator
  → characters（角色抽取+三视图，best effort）→ storyboard_cell → shot
  → image（角色三视图作为参考，跨镜头一致性）→ video → concat → 下载
```

手动触发走 tRPC：`runIdea2Script` / `runPlanScript` / `runEnhanceScript` / `runScript2Characters` / `runNovel2Scenes`（小说改编）/ `runSelectReference` / `runSelectBestImage`（多变体选优）/ `runCameraTree` / `runCharacterPortraits` / `runStoryPush`。

## 广告创作链（ad creative）

广告域方法论的单一来源见 `docs/specs/AD-CREATIVE-RESEARCH.md`，词条/结构在 `packages/contracts/src/ad-creative.ts`：

- 决策层工具：`create_ad`（DR 结构广告脚本，adBrief 持久化商品信息）/ `create_ad_variants`（钩子变体批量，服务在 `domain/canvas/ad-variants.ts`）/ `extract_product`（商品链接元数据，SSRF 防护在 `domain/ad/product-url.ts`）
- 口播 TTS：`audio.tts` job type（`runVoiceover`），TTS 生成器在 `tools/tts_generator_openai_api.py`；完成后回填 shot 的 `voiceoverAssetId`，不触发视觉级联
- 字幕烧录：concat 节点 `data.burnSubtitles` 开启，worker 按真实片段时长建 SRT 并用 ffmpeg 烧录（依赖 `fonts-noto-cjk`，`SUBTITLE_FONT` 可覆盖）；字幕参与 concat 缓存键

## 资产存储策略（Local-first）

中间产物二进制存**用户设备**（浏览器 IndexedDB），云端对象存储只做**瞬时中转**：

- `apps/web/src/lib/local-assets.ts` — IndexedDB 本地资产金库
- `apps/web/src/features/assets/useAssetSource.ts` — local-first 解析：本地命中直出 objectURL；未命中拉取二进制落库，随后（仅 generated 资产）调用 `asset.offload` 删除远端副本
- `apps/api/src/domain/asset/asset-offload.ts` — offload（幂等，upload 资产受保护）+ TTL 清扫（`ASSET_SWEEP_TTL_HOURS`，默认 24h，0 关闭）
- 下游依赖防护：offload 前检查资产生产节点是否仍有非 done 的直接下游（image→video→concat 的下一跳还要从对象存储读该二进制），有则跳过（`downstream_pending`）；TTL 清扫只避让 running 状态的下游，遗弃链到点仍清
- 用户手动「存到云端」走既有 requestUpload 通道，产物标记 `source=upload`，永不自动清除
- `assets.offloaded_at` 非空 = 二进制已不在云端（元数据行保留以维持节点引用）

## 已移除

以下根目录 Python 文件为早期并行设计，**未接入 Web 主链路**，已归档删除：

- `agents/decision_agent.py`
- `agents/supervision_agent.py`
- `pipelines/chat_pipeline.py`

如需 CLI 级完整管线（idea2video / script2video），使用根目录 `main_idea2video.py` / `main_script2video.py`。
