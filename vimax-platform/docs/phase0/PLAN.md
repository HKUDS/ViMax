# Phase 0 实施计划

## 执行顺序（TDD）

```
Step 1  抽取纯函数 + 写测试（红）
Step 2  实现纯函数（绿）
Step 3  P0-1 AppLayout 全屏
Step 4  P0-2 导航 URL + 首页透传
Step 5  P0-3/P0-4/P0-5 InfiniteCanvas 修复
Step 6  P0-6 useCanvasSnapshot 错误处理
Step 7  P0-7/P0-8 节点预览 + 下载
Step 8  typecheck + test 全绿
```

## 文件变更清单

| 操作 | 文件 |
|------|------|
| 新增 | `utils/canvas-navigation.ts` |
| 新增 | `utils/canvas-navigation.test.ts` |
| 新增 | `utils/node-defaults.ts` |
| 新增 | `utils/node-defaults.test.ts` |
| 新增 | `components/AssetPreview.tsx` |
| 修改 | `AppLayout.tsx` |
| 修改 | `page.tsx` |
| 修改 | `InfiniteCanvas.tsx` |
| 修改 | `useCanvasSnapshot.ts` |
| 修改 | `CanvasNodes.tsx` |
| 修改 | `NodeInspector.tsx` |
| 修改 | `package.json`（test script） |

## 预估工时

| 步骤 | 时间 |
|------|------|
| SDD + 测试 | 0.5d |
| 实现 | 1d |
| 联调验收 | 0.5d |
