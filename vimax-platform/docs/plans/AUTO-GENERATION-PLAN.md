# Plan: Auto-Generation v1

| 决议 | 路线A自动编排 / Phase1修复优先 / 移除重复Python |
|------|--------------------------------------------------|
| 预估 | 已完成 |

## 执行步骤

| Step | 任务 | 状态 |
|------|------|------|
| P1-01 | `generate_assets` 写回画布 image 节点 | ✅ |
| P1-02 | initialPrompt 去重（sessionStorage） | ✅ |
| P1-03 | image 节点 AssetPreview | ✅ |
| P1-04 | `layout.arrange` 接入 dagre/zone 布局 | ✅ |
| P1-05 | `edges.remove` mutation 处理 | ✅ |
| P1-06 | `chat.stop` AbortController 取消 | ✅ |
| P1-07 | WS 单例 shared-ws | ✅ |
| P2-01 | `pipeline-orchestrator.ts` + tRPC `runAutoPipeline` | ✅ |
| P2-02 | WS pipeline 事件协议 | ✅ |
| P2-03 | 自动模式开关 + PipelineStepper + 底部「全自动出片」 | ✅ |
| P3-01 | 删除重复 Python 决策文件 | ✅ |
| P3-02 | 补充 AGENTS.md | ✅ |

## 验收

1. 首页输入创意 → Overlay 生成 script/分镜 → 进入画布不重复发送
2. 画布底部「全自动出片」从 script 跑到 concat
3. Chat 开启「自动」模式后，Agent 完成即触发全自动管线
4. `pnpm test`（api）全绿
