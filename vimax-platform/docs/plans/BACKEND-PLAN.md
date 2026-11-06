# Plan: Backend 管线修复

| 决议 | i18n 延后 / 方案 A / 与 Phase 1 并行 |
|------|--------------------------------------|
| 预估 | 2-3 人天 |

## 执行步骤

| Step | 任务 | TDD |
|------|------|-----|
| B1 | 修正 `pipeline_handler/audio_handler/grid_handler` 调用 | — |
| B2 | 修正 `pipeline_main.py` JobReporter 构造 | — |
| B3 | `asset-utils.ts` + 测试 | ✅ |
| B4 | `storyboard-spawn.ts` + 测试 | ✅ |
| B5 | 扩展 `JobEventSchema.output.cells` | — |
| B6 | `job-event.service.ts` cells 分支 + asset kind | — |
| B7 | 前端 script done → refetch snapshot | — |
| B8 | `pnpm test` + typecheck 全绿 | — |

## 验收

- E2E-02 剧本转分镜出现 storyboard_cell 节点
- video asset kind=video
