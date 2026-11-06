"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PipelineStage, ServerWsMessage } from "@vimax/contracts";
import { trpc } from "@/lib/trpc/client";
import { sharedCanvasWs } from "@/lib/websocket/shared-ws";

export interface PipelineStageState {
  stage: PipelineStage;
  status: "pending" | "running" | "done" | "failed";
  done: number;
  total: number;
}

export interface AutoPipelineState {
  runId: string | null;
  status: "idle" | "running" | "done" | "failed" | "cancelled";
  stages: PipelineStageState[];
  summary: { succeeded: number; failed: number; skipped?: number; message?: string } | null;
}

const STAGE_ORDER: PipelineStage[] = ["storyboard", "shot", "image", "video", "concat"];

function initialStages(): PipelineStageState[] {
  return STAGE_ORDER.map((stage) => ({
    stage,
    status: "pending",
    done: 0,
    total: 0,
  }));
}

export function useAutoPipeline(canvasId: string) {
  const [state, setState] = useState<AutoPipelineState>({
    runId: null,
    status: "idle",
    stages: initialStages(),
    summary: null,
  });

  const runMutation = trpc.canvas.runAutoPipeline.useMutation();
  const retryMutation = trpc.canvas.retryFailed.useMutation();
  // WS 回调里触发重试——用 ref 避免 mutation 身份变化重订阅
  const retryRef = useRef<(() => Promise<void>) | undefined>(undefined);

  const retryFailed = useCallback(async () => {
    try {
      const res = await retryMutation.mutateAsync({ canvas_id: canvasId });
      const enq = res.enqueued.length;
      const skip = res.skipped.length;
      if (enq === 0 && skip === 0) toast.info("没有需要重试的失败节点");
      else toast.success(`已重试 ${enq} 个失败节点${skip ? `（${skip} 个暂不可重跑）` : ""}`);
    } catch {
      toast.error("重试失败节点出错");
    }
  }, [canvasId, retryMutation]);

  useEffect(() => {
    retryRef.current = retryFailed;
  }, [retryFailed]);

  useEffect(() => {
    const unsubscribe = sharedCanvasWs.subscribe(canvasId, (msg: ServerWsMessage) => {
      const type = msg.type as string;
      if (!type.startsWith("pipeline.")) return;
      if ("canvasId" in msg && msg.canvasId !== canvasId) return;

      switch (msg.type) {
        case "pipeline.stage_start":
          setState((prev) => ({
            ...prev,
            status: "running",
            runId: msg.runId,
            stages: prev.stages.map((s) =>
              s.stage === msg.stage
                ? { ...s, status: "running", total: msg.nodeIds.length, done: 0 }
                : s,
            ),
          }));
          break;
        case "pipeline.stage_progress":
          setState((prev) => ({
            ...prev,
            stages: prev.stages.map((s) =>
              s.stage === msg.stage ? { ...s, done: msg.done, total: msg.total } : s,
            ),
          }));
          break;
        case "pipeline.stage_done":
          setState((prev) => ({
            ...prev,
            stages: prev.stages.map((s) =>
              s.stage === msg.stage ? { ...s, status: "done" } : s,
            ),
          }));
          break;
        case "pipeline.node_failed":
          setState((prev) => ({
            ...prev,
            stages: prev.stages.map((s) =>
              s.stage === msg.stage ? { ...s, status: "failed" } : s,
            ),
          }));
          break;
        case "pipeline.finished": {
          const failed = msg.summary.failed;
          setState((prev) => ({
            ...prev,
            status: msg.summary.cancelled ? "cancelled" : failed > 0 ? "failed" : "done",
            summary: {
              succeeded: msg.summary.succeeded,
              failed,
              skipped: msg.summary.skipped,
              message: msg.summary.message,
            },
          }));
          const text = msg.summary.message ?? `完成 ${msg.summary.succeeded} 项，失败 ${failed} 项`;
          if (failed > 0) {
            toast.warning(text, {
              action: { label: "重试失败项", onClick: () => void retryRef.current?.() },
              duration: 12000,
            });
          } else {
            toast.success(text);
          }
          break;
        }
      }
    });
    return unsubscribe;
  }, [canvasId]);

  const start = useCallback(
    async (scriptNodeId?: string, opts?: { regenerate?: boolean }) => {
      setState({
        runId: null,
        status: "running",
        stages: initialStages(),
        summary: null,
      });
      try {
        const result = await runMutation.mutateAsync({
          canvas_id: canvasId,
          script_node_id: scriptNodeId,
          concurrency: 2,
          regenerate: opts?.regenerate,
        });
        setState((prev) => ({ ...prev, runId: result.run_id }));
        return result.run_id;
      } catch (err) {
        // 入队失败（如已有管线在运行）：回滚状态，别让按钮永远转圈
        setState({ runId: null, status: "failed", stages: initialStages(), summary: null });
        throw err;
      }
    },
    [canvasId, runMutation],
  );

  const cancel = useCallback(() => {
    if (!state.runId) return;
    sharedCanvasWs.send({
      type: "pipeline.cancel",
      runId: state.runId,
      canvasId,
    });
  }, [canvasId, state.runId]);

  return { state, start, cancel, retryFailed, isStarting: runMutation.isPending };
}
