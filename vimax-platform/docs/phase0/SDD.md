# Phase 0 — 内部交付基础修复 SDD

> 目标：让团队可自助完成「创建项目 → 生成视频 → 预览/下载」，消除静默失败与关键交互 bug。

## 1. 范围

| ID | 任务 | 优先级 |
|----|------|--------|
| P0-1 | 画布页全屏布局（跳过 AppShell） | P0 |
| P0-2 | 首页 → 画布模型参数透传 | P0 |
| P0-3 | 修复 video 节点默认模型 | P0 |
| P0-4 | 修复 Space + 拖拽平移 | P0 |
| P0-5 | 右键删除持久化 | P0 |
| P0-6 | API 失败显式错误，移除静默 demo | P0 |
| P0-7 | video/concat 节点内嵌预览 | P0 |
| P0-8 | concat 完成后突出下载 | P0 |

**不在范围**：节点分组、工作流保存、Python 全流程桥接、剪辑台、音频节点。

## 2. 架构变更

### 2.1 布局路由

```
AppLayout
├── /login, /signup     → 无 AppShell
├── /canvas/*           → 无 AppShell（新增）
└── 其他                → AppShell + TopNav
```

画布页保留自身 44px header，作为唯一顶栏。

### 2.2 纯函数抽取（可测试）

```
features/canvas/utils/
├── canvas-navigation.ts   # buildCanvasUrl, shouldSkipAppShell
└── node-defaults.ts       # getDefaultNodeData, FALLBACK_*_MODEL_ID
```

### 2.3 数据流：模型透传

```
HomePage (textModelId, imageModelId, videoModelId)
  → GenerationOverlay.onNavigate
  → buildCanvasUrl(canvasId, params)
  → /canvas/:id?textModelId=...&imageModelId=...&videoModelId=...
  → InfiniteCanvas(default*ModelId)
  → getDefaultNodeData(type, { imageModelId, videoModelId })
```

### 2.4 快照加载错误策略

```
Before: API 失败 → 静默加载 demo 数据
After:  API 失败 → isError=true → 错误 UI + 重试按钮
```

### 2.5 媒体预览

```
VideoNode / ConcatNode
  → AssetPreview(assetId)
  → trpc.canvas.getAssetUrl
  → <video src={url} controls />
```

## 3. 接口契约

### buildCanvasUrl

```ts
buildCanvasUrl("uuid", {
  textModelId?: string,
  imageModelId?: string,
  videoModelId?: string,
  prompt?: string,
  mode?: "idea" | "script",
}) → "/canvas/uuid?textModelId=..."
```

### getDefaultNodeData

```ts
getDefaultNodeData("video", { videoModelId: "veo-yunwu" })
// → { motionPreset: "zoom_in", durationSec: 4, modelId: "veo-yunwu", status: "idle" }

getDefaultNodeData("video") // 无 defaults
// → modelId: "doubao-seedance-1-0-lite"（非 image 模型）
```

## 4. TDD 测试矩阵

| 测试文件 | 覆盖 |
|---------|------|
| `canvas-navigation.test.ts` | URL 构建、空参数、AppShell 跳过 |
| `node-defaults.test.ts` | 各节点类型默认值、模型 fallback、video 非 image 模型 |

## 5. 验收标准

- [ ] 画布页无全局 TopNav，视口全屏
- [ ] 从首页创建并进入画布后，新建 video 节点使用所选视频模型
- [ ] Space 按住时可拖拽平移画布
- [ ] 右键删除节点后刷新页面节点不再出现
- [ ] 后端未启动时显示错误页，不显示 demo 画布
- [ ] video/concat 节点生成完成后画布内可播放
- [ ] concat 节点完成后 Inspector 下载区默认展开

## 6. 风险

| 风险 | 缓解 |
|------|------|
| getAssetUrl 对视频 MIME 返回 presigned URL | 已用于 VariantGallery，video 标签可直接播放 |
| 移除 demo 模式影响无后端开发 | 开发环境需启动 API；错误页提供重试 |
