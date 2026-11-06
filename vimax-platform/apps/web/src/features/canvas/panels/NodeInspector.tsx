"use client";

import { useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { ChevronDown, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import {
  VIDEO_MOTION_PRESETS,
  KEY_LIGHT_POSITIONS,
  RIM_LIGHT_PRESETS,
  AMBIENT_LIGHT_OPTIONS,
  ECOMMERCE_ASPECT_RATIOS,
  ECOMMERCE_SCENES,
  IMAGE_KIND_PRESETS,
  getAspectRatioPreset,
  getImageKindPreset,
} from "@vimax/contracts";
import { VariantGallery, type VariantEntry } from "./VariantGallery";
import { RUNNABLE_TYPES } from "../constants/canvas-flow";
import { STATUS_COLOR, NODE_TYPE_VISUALS } from "../constants/node-visuals";
import type { NodeRunState } from "../hooks/useNodeRun";

interface NodeInspectorProps {
  node: Node | null;
  onClose: () => void;
  onRunNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onUpdateNodeData?: (nodeId: string, key: string, value: unknown) => void;
  onGraphAppend?: (nodes: Node[], edges: Edge[]) => void;
  edges?: Edge[];
  nodes?: Node[];
  canvasId?: string;
  /** This node's own run state — progress/error stay correct while other nodes run in parallel. */
  runState?: NodeRunState;
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "object") return JSON.stringify(value, null, 1);
  return String(value);
}

const TYPE_LABELS: Record<string, string> = {
  script: "剧本节点",
  character: "角色节点",
  storyboard_cell: "分镜格节点",
  shot: "镜头节点",
  image: "首帧节点",
  video: "视频节点",
  concat: "合成节点",
};

export function NodeInspector({
  node,
  onClose,
  onRunNode,
  onDeleteNode,
  onUpdateNodeData,
  onGraphAppend,
  edges = [],
  nodes = [],
  canvasId,
  runState,
}: NodeInspectorProps) {
  if (!node) {
    return (
      <div
        style={{
          width: 300,
          padding: 24,
          borderLeft: "1px solid var(--color-border)",
          backgroundColor: "var(--color-bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <p style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          选择一个节点查看属性
        </p>
      </div>
    );
  }

  const typeLabel = TYPE_LABELS[node.type ?? ""] ?? node.type;
  const data = node.data as Record<string, unknown> | undefined;
  const status = (data?.status as string) ?? "idle";
  const isNodeRunning = runState?.active === true;
  const runProgress = runState?.progress ?? 0;
  const runError = runState?.error ?? null;

  return (
    <div
      style={{
        width: 300,
        borderLeft: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg)",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text)" }}>
            {typeLabel}
          </p>
          <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
            ID: {node.id.slice(0, 8)}…
          </p>
        </div>
        <button
          onClick={onClose}
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            border: "1px solid var(--color-border)",
            backgroundColor: "transparent",
            color: "var(--color-text-muted)",
            cursor: "pointer",
            fontSize: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ×
        </button>
      </div>

      {/* Status */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--color-border)",
        }}
      >
        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
          状态:{" "}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: STATUS_COLOR[status] ?? "var(--color-ink-muted)",
          }}
        >
          {status === "idle" && "待生成"}
          {status === "running" && "生成中…"}
          {status === "done" && "已完成"}
          {status === "dirty" && "已过期 (上游变更)"}
          {status === "failed" && "生成失败"}
        </span>
        {!!data?.outputAssetId && (
          <p style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>
            产出: {String(data.outputAssetId).slice(0, 8)}…
          </p>
        )}
      </div>

      {/* Run button + progress (for runnable types) */}
      {onRunNode && RUNNABLE_TYPES.has(node.type ?? "") && (
        <div
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--color-border)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {/* Run button */}
          <button
            onClick={() => onRunNode(node.id)}
            disabled={isNodeRunning || status === "running"}
            style={{
              width: "100%",
              padding: "8px 0",
              borderRadius: 8,
              border: "none",
              backgroundColor: "var(--color-accent)",
              color: "var(--color-accent-on)",
              fontWeight: 600,
              fontSize: 13,
              cursor: isNodeRunning || status === "running" ? "not-allowed" : "pointer",
              transition: "background-color 0.2s",
            }}
          >
            {isNodeRunning
              ? `生成中 ${runProgress}%`
              : status === "running"
                ? "排队中…"
                : status === "done"
                  ? "重新生成"
                  : status === "failed"
                    ? "重试"
                    : "运行"}
          </button>

          {/* Progress bar (this node only) */}
          {isNodeRunning && (
            <div
              style={{
                width: "100%",
                height: 3,
                borderRadius: 2,
                backgroundColor: "var(--color-border)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${runProgress}%`,
                  backgroundColor: "var(--color-node-running)",
                  transition: "width 0.3s",
                }}
              />
            </div>
          )}

          {/* Error message */}
          {!isNodeRunning && runError && (
            <p style={{ fontSize: 10, color: "var(--color-danger)" }}>
              {runError}
            </p>
          )}
        </div>
      )}

      {/* Data fields */}
      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)" }}>
          节点数据
        </p>
        {data &&
          Object.entries(data)
            .filter(([key]) => key !== "status" && key !== "outputAssetId")
            .map(([key, value]) => (
              <EditableField
                key={key}
                fieldKey={key}
                value={value}
                nodeId={node.id}
                onUpdate={onUpdateNodeData}
                nodeType={node.type}
              />
            ))}
        {(!data || Object.keys(data).length === 0) && (
          <p style={{ fontSize: 11, color: "var(--color-text-muted)" }}>无数据</p>
        )}
      </div>

      {/* Upstream / Downstream */}
      <NodeRelations nodeId={node.id} edges={edges} nodes={nodes} />

      {/* ── Extended Inspector Sections ── */}
      <ExtendedSections
        node={node}
        canvasId={canvasId}
        onUpdateNodeData={onUpdateNodeData}
        onGraphAppend={onGraphAppend}
        nodes={nodes}
      />

      {/* Delete button */}
      {onDeleteNode && (
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <button
            onClick={() => onDeleteNode(node.id)}
            style={{
              width: "100%",
              padding: "6px 0",
              borderRadius: 6,
              border: "1px solid color-mix(in srgb, var(--color-danger) 27%, transparent)",
              backgroundColor: "transparent",
              color: "var(--color-danger)",
              fontSize: 11,
              cursor: "pointer",
              opacity: 0.7,
              transition: "opacity 0.15s",
            }}
            onMouseOver={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = "1";
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLButtonElement).style.opacity = "0.7";
            }}
          >
            <Trash2 className="size-3" /> 删除节点
          </button>
          <p style={{ fontSize: 9, color: "var(--color-text-muted)", marginTop: 4, textAlign: "center" }}>
            快捷键: Delete
          </p>
        </div>
      )}

      {/* Position */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--color-border)",
          fontSize: 11,
          color: "var(--color-text-muted)",
        }}
      >
        <p>
          x: {Math.round(node.position.x)}, y: {Math.round(node.position.y)}
        </p>
      </div>
    </div>
  );
}

// ── Editable data field ──────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  prompt: "提示词",
  content: "内容",
  name: "名称",
  description: "描述",
  ffDesc: "首帧描述",
  lfDesc: "末帧描述",
  motionDesc: "运镜描述",
  audioDesc: "音频描述",
  shotBrief: "分镜简述",
  cameraIdx: "机位编号",
  variationType: "变体类型",
  modelId: "模型",
  size: "尺寸",
  motionPreset: "运镜预设",
  durationSec: "时长(秒)",
  referenceAssetIds: "参考图",
  transition: "转场",
  ffVisCharIdxs: "首帧可见角色",
  lfVisCharIdxs: "末帧可见角色",
  negativePrompt: "负向词",
  seed: "随机种子",
  clipOrder: "片段顺序",
};

const TEXTAREA_FIELDS = new Set([
  "prompt",
  "content",
  "description",
  "ffDesc",
  "lfDesc",
  "motionDesc",
  "audioDesc",
  "shotBrief",
]);

function EditableField({
  fieldKey,
  value,
  nodeId,
  onUpdate,
  nodeType,
}: {
  fieldKey: string;
  value: unknown;
  nodeId: string;
  onUpdate?: (nodeId: string, key: string, value: unknown) => void;
  nodeType?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value ?? ""));
  const isLongText = TEXTAREA_FIELDS.has(fieldKey);
  const strValue = String(value ?? "");

  // ── Special select fields ──
  if (fieldKey === "motionPreset" && nodeType === "video") {
    const categories = ["basic", "movement", "effect"];
    const catLabels: Record<string, string> = { basic: "基础运镜", movement: "运动运镜", effect: "效果运镜" };
    return (
      <div>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>
          {FIELD_LABELS[fieldKey] ?? fieldKey}
        </span>
        <select
          value={strValue}
          onChange={(e) => {
            if (onUpdate) onUpdate(nodeId, fieldKey, e.target.value);
          }}
          style={{
            width: "100%",
            fontSize: 11,
            color: "var(--color-text)",
            backgroundColor: "var(--color-bg)",
            borderRadius: 6,
            border: "1px solid var(--color-border)",
            padding: "4px 8px",
            outline: "none",
            fontFamily: "inherit",
          }}
        >
          {categories.map((cat) => (
            <optgroup key={cat} label={catLabels[cat] ?? cat}>
              {VIDEO_MOTION_PRESETS.filter((p) => p.category === cat).map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
    );
  }

  if (fieldKey === "modelId" && nodeType === "image") {
    return <ModelFieldSelect nodeId={nodeId} fieldKey={fieldKey} value={strValue} type="image" onUpdate={onUpdate} />;
  }

  if (fieldKey === "modelId" && nodeType === "video") {
    return <ModelFieldSelect nodeId={nodeId} fieldKey={fieldKey} value={strValue} type="video" onUpdate={onUpdate} />;
  }

  const commit = () => {
    setEditing(false);
    if (draft !== strValue && onUpdate) {
      onUpdate(nodeId, fieldKey, draft);
    }
  };

  if (!onUpdate) {
    // Read-only fallback
    return (
      <div>
        <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>
          {FIELD_LABELS[fieldKey] ?? fieldKey}
        </span>
        <div style={{ fontSize: 11, color: "var(--color-text)", backgroundColor: "var(--color-surface)", borderRadius: 6, padding: "4px 8px", wordBreak: "break-word", maxHeight: 100, overflowY: "auto" }}>
          {displayValue(value)}
        </div>
      </div>
    );
  }

  return (
    <div>
      <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>
        {FIELD_LABELS[fieldKey] ?? fieldKey}
      </span>
      {editing ? (
        isLongText ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(strValue);
                setEditing(false);
              }
            }}
            autoFocus
            rows={3}
            style={{
              width: "100%",
              fontSize: 11,
              color: "var(--color-text)",
              backgroundColor: "var(--color-bg)",
              borderRadius: 6,
              border: "1px solid var(--color-accent)",
              padding: "4px 8px",
              resize: "vertical",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        ) : (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") {
                setDraft(strValue);
                setEditing(false);
              }
            }}
            autoFocus
            style={{
              width: "100%",
              fontSize: 11,
              color: "var(--color-text)",
              backgroundColor: "var(--color-bg)",
              borderRadius: 6,
              border: "1px solid var(--color-accent)",
              padding: "4px 8px",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        )
      ) : (
        <div
          onClick={() => {
            setDraft(strValue);
            setEditing(true);
          }}
          title="点击编辑"
          style={{
            fontSize: 11,
            color: strValue ? "var(--color-text)" : "var(--color-text-muted)",
            backgroundColor: "var(--color-surface)",
            borderRadius: 6,
            padding: "4px 8px",
            wordBreak: "break-word",
            maxHeight: 100,
            overflowY: "auto",
            cursor: "text",
            border: "1px solid transparent",
            transition: "border-color 0.15s",
          }}
          onMouseOver={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = "var(--color-border)";
          }}
          onMouseOut={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = "transparent";
          }}
        >
          {strValue || "（空，点击编辑）"}
        </div>
      )}
    </div>
  );
}

// ── Upstream / Downstream relationships ─────────────────────────────

function NodeRelations({
  nodeId,
  edges,
  nodes,
}: {
  nodeId: string;
  edges: Edge[];
  nodes: Node[];
}) {
  const upstream = edges
    .filter((e) => e.target === nodeId)
    .map((e) => nodes.find((n) => n.id === e.source))
    .filter(Boolean) as Node[];

  const downstream = edges
    .filter((e) => e.source === nodeId)
    .map((e) => nodes.find((n) => n.id === e.target))
    .filter(Boolean) as Node[];

  if (upstream.length === 0 && downstream.length === 0) return null;

  return (
    <div
      style={{
        padding: "10px 16px",
        borderTop: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {upstream.length > 0 && (
        <div>
          <span style={{ fontSize: 10, color: "var(--color-ink-subtle)", fontWeight: 600 }}>
            上游 ({upstream.length})
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
            {upstream.map((n) => {
              const st = (n.data as Record<string, unknown>)?.status as string ?? "idle";
              const stColor = STATUS_COLOR[st] ?? STATUS_COLOR.idle;
              return (
                <div
                  key={n.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10,
                    color: "var(--color-text-muted)",
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: stColor, flexShrink: 0 }} />
                  <span>{NODE_TYPE_VISUALS[n.type as keyof typeof NODE_TYPE_VISUALS]?.label ?? "?"}</span>
                  <span style={{ color: "var(--color-text)" }}>{n.id.slice(0, 6)}…</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {downstream.length > 0 && (
        <div>
          <span style={{ fontSize: 10, color: "var(--color-ink-subtle)", fontWeight: 600 }}>
            下游 ({downstream.length})
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
            {downstream.map((n) => {
              const st = (n.data as Record<string, unknown>)?.status as string ?? "idle";
              const stColor = STATUS_COLOR[st] ?? STATUS_COLOR.idle;
              return (
                <div
                  key={n.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 10,
                    color: "var(--color-text-muted)",
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: stColor, flexShrink: 0 }} />
                  <span>{NODE_TYPE_VISUALS[n.type as keyof typeof NODE_TYPE_VISUALS]?.label ?? "?"}</span>
                  <span style={{ color: "var(--color-text)" }}>{n.id.slice(0, 6)}…</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// Collapsible Section helper
// ══════════════════════════════════════════════════════════════════════

function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      style={{
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)" }}>
          {title}
        </span>
        <ChevronDown
          size={11}
          style={{ marginLeft: "auto", color: "var(--color-text-muted)", transition: "transform 0.15s", transform: open ? "none" : "rotate(-90deg)" }}
        />
      </div>
      {open && (
        <div style={{ padding: "0 16px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Shared button styles ─────────────────────────────────────────────

const BTN_PRIMARY: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "none",
  backgroundColor: "var(--color-accent)",
  color: "var(--color-accent-on)",
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
};

const BTN_SECONDARY: React.CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  backgroundColor: "transparent",
  color: "var(--color-text)",
  fontSize: 11,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
};

const SELECT_STYLE: React.CSSProperties = {
  width: "100%",
  fontSize: 11,
  color: "var(--color-text)",
  backgroundColor: "var(--color-bg)",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  padding: "4px 8px",
  outline: "none",
  fontFamily: "inherit",
};

const RANGE_STYLE: React.CSSProperties = {
  width: "100%",
  accentColor: "var(--color-accent)",
};

// ══════════════════════════════════════════════════════════════════════
// Extended Inspector Sections (all new sections before delete button)
// ══════════════════════════════════════════════════════════════════════

function ExtendedSections({
  node,
  canvasId,
  onUpdateNodeData,
  onGraphAppend,
  nodes,
}: {
  node: Node;
  canvasId?: string;
  onUpdateNodeData?: (nodeId: string, key: string, value: unknown) => void;
  onGraphAppend?: (nodes: Node[], edges: Edge[]) => void;
  nodes?: Node[];
}) {
  const data = node.data as Record<string, unknown>;
  const type = node.type ?? "";
  const cid = canvasId ?? "";

  // ── tRPC mutations ──
  const characterViewMut = trpc.canvas.runCharacterView.useMutation();
  const script2StoryboardMut = trpc.canvas.runScript2Storyboard.useMutation();
  const multiCameraMut = trpc.canvas.runMultiCameraGrid.useMutation();
  const motionPredictionMut = trpc.canvas.runMotionPrediction.useMutation();
  const gridSplitMut = trpc.canvas.runGridSplit.useMutation();
  const storyPushMut = trpc.canvas.runStoryPush.useMutation();
  const audioMut = trpc.canvas.runAudioGeneration.useMutation();
  const storyboard2ShotMut = trpc.canvas.runStoryboard2Shot.useMutation();

  return (
    <>
      {/* Visible characters (shot nodes) — select whose front portraits feed
          the first frame, for cross-shot character consistency. */}
      {type === "shot" && (nodes ?? []).some((n) => n.type === "character") && (
        <CollapsibleSection title="出场角色">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(nodes ?? [])
              .filter((n) => n.type === "character")
              .map((c) => {
                const name =
                  ((c.data as Record<string, unknown>).name as string) ?? c.id.slice(0, 6);
                const checked = ((data.visibleCharIds as string[]) ?? []).includes(c.id);
                return (
                  <label
                    key={c.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      color: "var(--color-text)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const current = new Set((data.visibleCharIds as string[]) ?? []);
                        if (e.target.checked) current.add(c.id);
                        else current.delete(c.id);
                        onUpdateNodeData?.(node.id, "visibleCharIds", [...current]);
                      }}
                    />
                    {name}
                  </label>
                );
              })}
          </div>
          <p style={{ fontSize: 9, color: "var(--color-text-dim)", margin: "4px 0 0" }}>
            选中角色的定妆图将作为首帧参考，保持跨镜头角色一致。
          </p>
        </CollapsibleSection>
      )}

      {/* 3b. Lighting Control (shot nodes) */}
      {type === "shot" && (
        <CollapsibleSection title="灯光控制">
          <div>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>
              主灯位置
            </span>
            <select
              value={(data.keyLightPosition as string) ?? ""}
              onChange={(e) => onUpdateNodeData?.(node.id, "keyLightPosition", e.target.value)}
              style={SELECT_STYLE}
            >
              <option value="">（未设置）</option>
              {KEY_LIGHT_POSITIONS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>
              主灯强度: {((data.keyLightIntensity as number) ?? 50)}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={(data.keyLightIntensity as number) ?? 50}
              onChange={(e) => onUpdateNodeData?.(node.id, "keyLightIntensity", Number(e.target.value))}
              style={RANGE_STYLE}
            />
          </div>

          <div>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>
              轮廓光
            </span>
            <select
              value={(data.rimLight as string) ?? "none"}
              onChange={(e) => onUpdateNodeData?.(node.id, "rimLight", e.target.value)}
              style={SELECT_STYLE}
            >
              {RIM_LIGHT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>
              环境光
            </span>
            <select
              value={(data.ambientLight as string) ?? "neutral"}
              onChange={(e) => onUpdateNodeData?.(node.id, "ambientLight", e.target.value)}
              style={SELECT_STYLE}
            >
              {AMBIENT_LIGHT_OPTIONS.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
        </CollapsibleSection>
      )}

      {/* 3c. Focus/DOF Control (shot nodes) */}
      {type === "shot" && (
        <CollapsibleSection title="焦点/景深">
          <div>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>
              焦点位置 (点击设置)
            </span>
            <FocusPointPicker
              value={(data.focusPoint as { x: number; y: number }) ?? { x: 0.5, y: 0.5 }}
              onChange={(pt) => onUpdateNodeData?.(node.id, "focusPoint", pt)}
            />
          </div>

          <div>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>
              焦点半径: {((data.focusRadius as number) ?? 30)}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={(data.focusRadius as number) ?? 30}
              onChange={(e) => onUpdateNodeData?.(node.id, "focusRadius", Number(e.target.value))}
              style={RANGE_STYLE}
            />
          </div>

          <div>
            <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>
              散景强度: {((data.bokehStrength as number) ?? 50)}%
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={(data.bokehStrength as number) ?? 50}
              onChange={(e) => onUpdateNodeData?.(node.id, "bokehStrength", Number(e.target.value))}
              style={RANGE_STYLE}
            />
          </div>
        </CollapsibleSection>
      )}

      {/* 3d. Character Three-View Section */}
      {type === "character" && (
        <CollapsibleSection title="三视图生成">
          <div style={{ display: "flex", gap: 4 }}>
            <button
              style={BTN_SECONDARY}
              onClick={() => {
                characterViewMut.mutate({ canvas_id: cid, node_id: node.id, view: "front" });
              }}
            >
              生成正面
            </button>
            <button
              style={BTN_SECONDARY}
              disabled={!data.frontAssetId}
              onClick={() => {
                characterViewMut.mutate({ canvas_id: cid, node_id: node.id, view: "side" });
              }}
            >
              生成侧面
            </button>
            <button
              style={BTN_SECONDARY}
              disabled={!data.frontAssetId}
              onClick={() => {
                characterViewMut.mutate({ canvas_id: cid, node_id: node.id, view: "back" });
              }}
            >
              生成背面
            </button>
          </div>
          {/* Status indicators */}
          <div style={{ display: "flex", gap: 8, fontSize: 10, color: "var(--color-text-muted)" }}>
            <span>正面: {data.frontAssetId ? "已设" : "未设"}</span>
            <span>侧面: {data.sideAssetId ? "已设" : "未设"}</span>
            <span>背面: {data.backAssetId ? "已设" : "未设"}</span>
          </div>
          {characterViewMut.isPending && (
            <p style={{ fontSize: 10, color: "var(--color-node-running)" }}>生成中…</p>
          )}
          {characterViewMut.isError && (
            <p style={{ fontSize: 10, color: "var(--color-danger)" }}>错误: {characterViewMut.error.message}</p>
          )}
        </CollapsibleSection>
      )}

      {/* 3e. Auto-Storyboard (script nodes) */}
      {type === "script" && (data.content as string) && (
        <CollapsibleSection title="智能分镜">
          <p style={{ fontSize: 10, color: "var(--color-text-muted)", margin: "0 0 8px", lineHeight: 1.5 }}>
            调用 ViMax StoryboardArtist，与 CLI 管线相同的智能分镜能力。若画布已有角色节点，会自动纳入分镜设计。
          </p>
          <button
            style={BTN_PRIMARY}
            disabled={script2StoryboardMut.isPending}
            onClick={() => {
              script2StoryboardMut.mutate({ canvas_id: cid, node_id: node.id });
            }}
          >
            生成智能分镜
          </button>
          {script2StoryboardMut.isPending && (
            <p style={{ fontSize: 10, color: "var(--color-node-running)" }}>生成中…</p>
          )}
          {script2StoryboardMut.isError && (
            <p style={{ fontSize: 10, color: "var(--color-danger)" }}>错误: {script2StoryboardMut.error.message}</p>
          )}
        </CollapsibleSection>
      )}

      {/* Expand to Shot (storyboard_cell nodes) — mirrors idea2video's
          decompose_visual_description: turn one storyboard brief into a
          fully-populated shot node, appended live to the canvas. */}
      {type === "storyboard_cell" && ((data.shotBrief as string) ?? "").trim() && (
        <CollapsibleSection title="展开为镜头">
          <button
            style={BTN_PRIMARY}
            disabled={storyboard2ShotMut.isPending}
            onClick={() => {
              storyboard2ShotMut.mutate(
                { canvas_id: cid, node_id: node.id },
                {
                  onSuccess: (result) => {
                    onUpdateNodeData?.(node.id, "status", "done");
                    onGraphAppend?.([result.shot_node], [result.edge]);
                  },
                },
              );
            }}
          >
            展开为镜头
          </button>
          {storyboard2ShotMut.isPending && (
            <p style={{ fontSize: 10, color: "var(--color-node-running)" }}>展开中…</p>
          )}
          {storyboard2ShotMut.isError && (
            <p style={{ fontSize: 10, color: "var(--color-danger)" }}>错误: {storyboard2ShotMut.error.message}</p>
          )}
        </CollapsibleSection>
      )}

      {/* 3f. Multi-Camera Grid (shot nodes) */}
      {type === "shot" && (
        <CollapsibleSection title="多机位宫格">
          <div style={{ display: "flex", gap: 4 }}>
            <button
              style={BTN_SECONDARY}
              disabled={multiCameraMut.isPending}
              onClick={() => {
                multiCameraMut.mutate({ canvas_id: cid, node_id: node.id, grid_size: "3x3" });
              }}
            >
              3×3 宫格
            </button>
            <button
              style={BTN_SECONDARY}
              disabled={multiCameraMut.isPending}
              onClick={() => {
                multiCameraMut.mutate({ canvas_id: cid, node_id: node.id, grid_size: "5x5" });
              }}
            >
              5×5 宫格
            </button>
          </div>
          {multiCameraMut.isPending && (
            <p style={{ fontSize: 10, color: "var(--color-node-running)" }}>生成中…</p>
          )}
          {multiCameraMut.isError && (
            <p style={{ fontSize: 10, color: "var(--color-danger)" }}>错误: {multiCameraMut.error.message}</p>
          )}
        </CollapsibleSection>
      )}

      {/* 3g. Motion Prediction (image nodes with output) */}
      {type === "image" && data.outputAssetId && (
        <CollapsibleSection title="画面推演">
          <div style={{ display: "flex", gap: 4 }}>
            <button
              style={BTN_SECONDARY}
              disabled={motionPredictionMut.isPending}
              onClick={() => {
                motionPredictionMut.mutate({ canvas_id: cid, node_id: node.id, direction: "forward", seconds: 3 });
              }}
            >
              推演 3 秒后
            </button>
            <button
              style={BTN_SECONDARY}
              disabled={motionPredictionMut.isPending}
              onClick={() => {
                motionPredictionMut.mutate({ canvas_id: cid, node_id: node.id, direction: "backward", seconds: 5 });
              }}
            >
              推演 5 秒前
            </button>
          </div>
          {motionPredictionMut.isPending && (
            <p style={{ fontSize: 10, color: "var(--color-node-running)" }}>推演中…</p>
          )}
          {motionPredictionMut.isError && (
            <p style={{ fontSize: 10, color: "var(--color-danger)" }}>错误: {motionPredictionMut.error.message}</p>
          )}
        </CollapsibleSection>
      )}

      {/* 3h. Grid Split (image nodes with output) */}
      {type === "image" && data.outputAssetId && (
        <CollapsibleSection title="宫格切分">
          <div style={{ display: "flex", gap: 4 }}>
            <button
              style={BTN_SECONDARY}
              disabled={gridSplitMut.isPending}
              onClick={() => {
                gridSplitMut.mutate({ canvas_id: cid, node_id: node.id, grid_size: "3x3" });
              }}
            >
              切分 3×3
            </button>
            <button
              style={BTN_SECONDARY}
              disabled={gridSplitMut.isPending}
              onClick={() => {
                gridSplitMut.mutate({ canvas_id: cid, node_id: node.id, grid_size: "5x5" });
              }}
            >
              切分 5×5
            </button>
          </div>
          {gridSplitMut.isPending && (
            <p style={{ fontSize: 10, color: "var(--color-node-running)" }}>切分中…</p>
          )}
          {gridSplitMut.isError && (
            <p style={{ fontSize: 10, color: "var(--color-danger)" }}>错误: {gridSplitMut.error.message}</p>
          )}
        </CollapsibleSection>
      )}

      {/* 3j. Variants (image nodes) — generate N, pick the best */}
      {type === "image" && (
        <CollapsibleSection title="变体择优">
          <VariantGallery
            canvasId={cid}
            nodeId={node.id}
            variants={(data.variants as VariantEntry[] | undefined) ?? []}
            currentOutputAssetId={data.outputAssetId as string | undefined}
          />
        </CollapsibleSection>
      )}

      {/* 3k. Image kind presets (e-commerce + creative asset flavors) */}
      {type === "image" && (
        <CollapsibleSection title="图片预设">
          <label style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>
            用途类型
          </label>
          <select
            value={(data.kind as string) ?? "generic"}
            onChange={(e) => {
              const preset = getImageKindPreset(e.target.value);
              onUpdateNodeData?.(node.id, "kind", e.target.value);
              if (preset) onUpdateNodeData?.(node.id, "size", preset.size);
            }}
            style={SELECT_STYLE}
          >
            <option value="generic">通用</option>
            <optgroup label="电商">
              <option value="product">商品图</option>
              <option value="scene">场景图</option>
              <option value="model">模特图</option>
              <option value="ad">广告图</option>
            </optgroup>
            <optgroup label="创意素材">
              {IMAGE_KIND_PRESETS.map((p) => (
                <option key={p.kind} value={p.kind}>
                  {p.label}
                </option>
              ))}
            </optgroup>
          </select>

          <label style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginTop: 6, marginBottom: 2 }}>
            画幅比例
          </label>
          <select
            value={(data.aspectRatio as string) ?? ""}
            onChange={(e) => {
              const preset = getAspectRatioPreset(e.target.value);
              onUpdateNodeData?.(node.id, "aspectRatio", e.target.value);
              if (preset) onUpdateNodeData?.(node.id, "size", preset.size);
            }}
            style={SELECT_STYLE}
          >
            <option value="">自定义</option>
            {ECOMMERCE_ASPECT_RATIOS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>

          <label style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginTop: 6, marginBottom: 2 }}>
            场景/背景
          </label>
          <select
            value={(data.scene as string) ?? ""}
            onChange={(e) => onUpdateNodeData?.(node.id, "scene", e.target.value)}
            style={SELECT_STYLE}
          >
            <option value="">无</option>
            {ECOMMERCE_SCENES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <p style={{ fontSize: 9, color: "var(--color-text-dim)", margin: "4px 0 0" }}>
            场景预设会在生成时自动并入提示词。
          </p>
        </CollapsibleSection>
      )}

      {/* 3i. Story Push (shot nodes) */}
      {type === "shot" && (
        <CollapsibleSection title="剧情推演">
          <button
            style={BTN_PRIMARY}
            disabled={storyPushMut.isPending}
            onClick={() => {
              storyPushMut.mutate({ canvas_id: cid, node_id: node.id });
            }}
          >
            推演 4 帧
          </button>
          {storyPushMut.isPending && (
            <p style={{ fontSize: 10, color: "var(--color-node-running)" }}>推演中…</p>
          )}
          {storyPushMut.isError && (
            <p style={{ fontSize: 10, color: "var(--color-danger)" }}>错误: {storyPushMut.error.message}</p>
          )}
        </CollapsibleSection>
      )}

      {/* 3j. Audio Generation (shot nodes with audioDesc) */}
      {type === "shot" && (data.audioDesc as string) && (
        <CollapsibleSection title="音频生成">
          <button
            style={BTN_PRIMARY}
            disabled={audioMut.isPending}
            onClick={() => {
              audioMut.mutate({ canvas_id: cid, node_id: node.id });
            }}
          >
            生成音频
          </button>
          {audioMut.isPending && (
            <p style={{ fontSize: 10, color: "var(--color-node-running)" }}>生成中…</p>
          )}
          {audioMut.isError && (
            <p style={{ fontSize: 10, color: "var(--color-danger)" }}>错误: {audioMut.error.message}</p>
          )}
        </CollapsibleSection>
      )}

      {/* 3k. Download (video/concat nodes with output) */}
      {(type === "video" || type === "concat") && data.outputAssetId && (
        <CollapsibleSection
          title={type === "concat" ? "下载成片" : "下载"}
          defaultOpen={type === "concat" || data.status === "done"}
        >
          <DownloadButton canvasId={cid} nodeId={node.id} />
        </CollapsibleSection>
      )}
    </>
  );
}

// ── Focus Point Picker ──────────────────────────────────────────────

function FocusPointPicker({
  value,
  onChange,
}: {
  value: { x: number; y: number };
  onChange: (pt: { x: number; y: number }) => void;
}) {
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    onChange({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
  };

  return (
    <div
      onClick={handleClick}
      style={{
        width: 200,
        height: 120,
        borderRadius: 6,
        border: "1px solid var(--color-border)",
        backgroundColor: "var(--color-surface)",
        position: "relative",
        cursor: "crosshair",
      }}
    >
      {/* Crosshair indicator */}
      <div
        style={{
          position: "absolute",
          left: `${value.x * 100}%`,
          top: `${value.y * 100}%`,
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: "var(--color-accent)",
          border: "2px solid var(--color-surface-1)",
          transform: "translate(-50%, -50%)",
          pointerEvents: "none",
        }}
      />
      <span style={{ position: "absolute", bottom: 4, right: 6, fontSize: 9, color: "var(--color-text-muted)" }}>
        ({Math.round(value.x * 100)}%, {Math.round(value.y * 100)}%)
      </span>
    </div>
  );
}

// ── Model Field Select (dynamic DB-backed model list) ─────────────────

function ModelFieldSelect({
  nodeId,
  fieldKey,
  value,
  type,
  onUpdate,
}: {
  nodeId: string;
  fieldKey: string;
  value: string;
  type: "image" | "video";
  onUpdate?: (nodeId: string, key: string, value: unknown) => void;
}) {
  const { data } = trpc.modelConfig.list.useQuery(
    { type },
    { staleTime: 60_000 },
  );
  const models = data?.items ?? [];

  return (
    <div>
      <span style={{ fontSize: 10, color: "var(--color-text-muted)", display: "block", marginBottom: 2 }}>
        {FIELD_LABELS[fieldKey] ?? fieldKey}
      </span>
      <select
        value={value}
        onChange={(e) => {
          if (onUpdate) onUpdate(nodeId, fieldKey, e.target.value);
        }}
        style={{
          width: "100%",
          fontSize: 11,
          color: "var(--color-text)",
          backgroundColor: "var(--color-bg)",
          borderRadius: 6,
          border: "1px solid var(--color-border)",
          padding: "4px 8px",
          outline: "none",
          fontFamily: "inherit",
        }}
      >
        {models.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} {m.isDefault ? "（默认）" : ""}
          </option>
        ))}
        {models.length === 0 && (
          <option value="">无可用模型</option>
        )}
      </select>
    </div>
  );
}

// ── Download Button (uses query) ────────────────────────────────────

function DownloadButton({ canvasId, nodeId }: { canvasId: string; nodeId: string }) {
  const [requested, setRequested] = useState(false);
  const { data, isLoading, error } = trpc.canvas.getExportUrl.useQuery(
    { canvas_id: canvasId, node_id: nodeId },
    { enabled: requested },
  );

  const handleClick = () => {
    setRequested(true);
  };

  // Auto-open when URL arrives
  if (data?.download_url && requested) {
    window.open(data.download_url, "_blank");
    setRequested(false);
  }

  return (
    <div>
      <button
        style={BTN_PRIMARY}
        onClick={handleClick}
        disabled={isLoading}
      >
        {isLoading ? "获取链接…" : "下载"}
      </button>
      {error && (
        <p style={{ fontSize: 10, color: "var(--color-danger)", marginTop: 4 }}>错误: {error.message}</p>
      )}
      {data?.filename && (
        <p style={{ fontSize: 10, color: "var(--color-text-muted)", marginTop: 4 }}>
          文件: {data.filename}
        </p>
      )}
    </div>
  );
}