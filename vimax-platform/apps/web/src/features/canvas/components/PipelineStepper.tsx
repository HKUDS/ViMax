"use client";

import type { AutoPipelineState } from "../hooks/useAutoPipeline";

const STAGE_LABELS: Record<string, string> = {
  storyboard: "分镜",
  shot: "镜头",
  image: "图片",
  video: "视频",
  concat: "合成",
};

interface PipelineStepperProps {
  state: AutoPipelineState;
  onCancel?: () => void;
  onRetryFailed?: () => void;
}

export function PipelineStepper({ state, onCancel, onRetryFailed }: PipelineStepperProps) {
  if (state.status === "idle") return null;

  // Overall progress across all stages (done units / total units)
  const totalUnits = state.stages.reduce((acc, s) => acc + (s.total || 0), 0);
  const doneUnits = state.stages.reduce((acc, s) => acc + (s.done || 0), 0);
  const overallPercent =
    state.status === "done" ? 100 : totalUnits > 0 ? Math.round((doneUnits / totalUnits) * 100) : 0;

  return (
    <div
      style={{
        padding: "8px 12px",
        borderBottom: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text)" }}>
          {state.status === "running"
            ? "自动生成中…"
            : state.status === "done"
              ? "生成完成"
              : state.status === "cancelled"
                ? "已取消"
                : "生成结束（部分失败）"}
        </span>
        {state.status === "running" && onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid var(--color-danger)",
              backgroundColor: "transparent",
              color: "var(--color-danger)",
              cursor: "pointer",
            }}
          >
            停止
          </button>
        )}
        {state.status === "failed" && state.summary && state.summary.failed > 0 && onRetryFailed && (
          <button
            type="button"
            onClick={onRetryFailed}
            style={{
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid var(--color-accent)",
              backgroundColor: "transparent",
              color: "var(--color-accent)",
              cursor: "pointer",
            }}
          >
            重试失败项
          </button>
        )}
      </div>
      {/* Overall progress bar */}
      {state.status === "running" && (
        <div
          style={{
            height: 3,
            borderRadius: 2,
            backgroundColor: "var(--color-hairline)",
            overflow: "hidden",
            marginBottom: 6,
          }}
          role="progressbar"
          aria-valuenow={overallPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            style={{
              height: "100%",
              width: `${Math.max(overallPercent, 2)}%`,
              borderRadius: 2,
              background:
                "linear-gradient(90deg, var(--color-node-running), var(--color-accent))",
              transition: "width 0.4s ease",
            }}
          />
        </div>
      )}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {state.stages.map((s) => {
          const color =
            s.status === "done"
              ? "var(--color-success)"
              : s.status === "running"
                ? "var(--color-node-running)"
                : s.status === "failed"
                  ? "var(--color-danger)"
                  : "var(--color-text-muted)";
          return (
            <span
              key={s.stage}
              style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 10,
                border: `1px solid ${color}40`,
                color,
                backgroundColor: `${color}10`,
              }}
            >
              {STAGE_LABELS[s.stage] ?? s.stage}
              {s.status === "running" && s.total > 0 ? ` ${s.done}/${s.total}` : ""}
            </span>
          );
        })}
      </div>
      {state.summary && (
        <div style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>
          成功 {state.summary.succeeded} · 失败 {state.summary.failed}
          {state.summary.skipped ? ` · 跳过 ${state.summary.skipped}` : ""}
          {state.summary.message ? ` — ${state.summary.message}` : ""}
        </div>
      )}
    </div>
  );
}
