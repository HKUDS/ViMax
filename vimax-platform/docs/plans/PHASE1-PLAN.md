# Plan: Phase 1 前端重构（精简版）

| 决议 | i18n 延后 / 与 Backend 并行 |
|------|------------------------------|
| 预估 | 3-4 人天 |

## 执行步骤

| Step | 任务 | TDD |
|------|------|-----|
| F1 | 抽出 `NodePalette.tsx` | — |
| F2 | 抽出 `BottomToolbar.tsx` | — |
| F3 | 新增 `graph-mutations.ts` + 测试 | ✅ |
| F4 | 修复复制节点 save、拖拽 save | — |
| F5 | `CanvasProvider.tsx` | — |
| F6 | `FlowCanvas.tsx` + `CanvasShell.tsx` | — |
| F7 | `InfiniteCanvas.tsx` 瘦身 ≤150 行 | — |
| F8 | toolbar/palette Tailwind + Lucide | — |
| F9 | `pnpm test` + typecheck 全绿 | — |

## 不在本 Plan

- i18n（延后）
- 节点分组 / 工作流
