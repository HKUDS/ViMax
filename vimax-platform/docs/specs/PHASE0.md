# Spec: Phase 0 — 基础修复

| 属性 | 值 |
|------|-----|
| 版本 | 1.0 |
| 状态 | ✅ 已实现 |
| 实现日期 | 2026-07-16 |

---

## 1. 目标

修复阻碍内部使用的 P0 级前端 bug，使核心画布流程可稳定运行。

---

## 2. 功能需求

| ID | 需求 | 状态 |
|----|------|------|
| FR-P0-01 | `/canvas/*` 跳过 AppShell，全屏布局 | ✅ |
| FR-P0-02 | `buildCanvasUrl()` 透传 model 参数 | ✅ |
| FR-P0-03 | video 节点默认 `doubao-seedance-1-0-lite` | ✅ |
| FR-P0-04 | Space+拖拽平移（state 非 ref） | ✅ |
| FR-P0-05 | 右键删除调用 `handleDeleteNode` 持久化 | ✅ |
| FR-P0-06 | API 失败显示错误页，移除 demo fallback | ✅ |
| FR-P0-07 | video/concat 节点内嵌 `AssetPreview` | ✅ |
| FR-P0-08 | concat 下载区默认展开 + 「可下载」标签 | ✅ |

---

## 3. 技术实现

### 3.1 新增文件

```
apps/web/src/features/canvas/
├── utils/canvas-navigation.ts
├── utils/canvas-navigation.test.ts
├── utils/node-defaults.ts
├── utils/node-defaults.test.ts
└── components/AssetPreview.tsx
```

### 3.2 修改文件

- `AppLayout.tsx` — `shouldSkipAppShell()`
- `page.tsx` — `buildCanvasUrl()` 导航
- `InfiniteCanvas.tsx` — 平移/删除/模型默认值
- `useCanvasSnapshot.ts` — 错误处理
- `CanvasNodes.tsx` — 视频预览
- `NodeInspector.tsx` — 下载区
- `package.json` — `pnpm test` 脚本

---

## 4. 测试

```bash
cd vimax-platform/apps/web
pnpm test      # 12/12 通过
pnpm typecheck # 零错误
```

| 测试文件 | 用例 |
|---------|------|
| `canvas-navigation.test.ts` | 5 |
| `node-defaults.test.ts` | 5 |

---

## 5. 验收记录

| 验收项 | 结果 |
|--------|------|
| 画布页无全局 TopNav | ✅ |
| 模型参数透传 | ✅ |
| Space 平移 | ✅ 代码已修，待人工确认 |
| 右键删除持久化 | ✅ 代码已修，待人工确认 |
| API 失败错误页 | ✅ |
| 节点内视频预览 | ✅ 代码已实现，待联调 |
| concat 下载突出 | ✅ |

---

## 6. 已知遗留

| 项 | 说明 | 归属 |
|----|------|------|
| 右键「复制节点」不 save | 低优先级 | Phase 1 |
| `handleNodesChange` 拖拽 save 闭包陈旧 | 低优先级 | Phase 1 |
| AI Chat 创建节点未用 modelDefaults | 中优先级 | Phase 1 |
| 项目列表链接不带 model 参数 | 可接受（重开项目） | — |

---

## 7. 参考文档

- 设计细节：`docs/phase0/SDD.md`（历史 SDD，已被本 Spec 取代）
- 实施记录：`docs/phase0/PLAN.md`（历史 Plan，已被本 Spec 取代）
