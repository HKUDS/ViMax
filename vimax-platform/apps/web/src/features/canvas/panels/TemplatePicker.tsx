"use client";

import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc/client";
import type { InstantiatedEdge, InstantiatedNode } from "@vimax/contracts";

// ── Template category labels ───────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  ecommerce: "电商",
  "short-drama": "短剧",
  ad: "广告",
  general: "通用",
};

const CATEGORY_COLOR: Record<string, string> = {
  ecommerce: "var(--color-success)",
  "short-drama": "var(--color-node-script)",
  ad: "var(--color-node-character)",
  general: "var(--color-ink-subtle)",
};

interface TemplatePickerProps {
  canvasId: string;
  onInstantiated: (nodes: InstantiatedNode[], edges: InstantiatedEdge[]) => void;
}

/**
 * Floating "one-click workflow" picker. Lists pre-built canvas graphs
 * (电商商品图 / 短剧 / 广告) and drops an instantiated copy onto the canvas.
 */
export function TemplatePicker({ canvasId, onInstantiated }: TemplatePickerProps) {
  const [open, setOpen] = useState(false);
  const templatesQuery = trpc.canvas.listTemplates.useQuery(undefined, {
    staleTime: 60_000,
  });
  const instantiate = trpc.canvas.instantiateTemplate.useMutation();

  const handlePick = async (templateId: string, name: string) => {
    try {
      const res = await instantiate.mutateAsync({
        canvas_id: canvasId,
        template_id: templateId,
      });
      onInstantiated(res.nodes, res.edges);
      toast.success(`已添加模板「${name}」（${res.nodes.length} 个节点）`);
      setOpen(false);
    } catch {
      toast.error("添加模板失败");
    }
  };

  const templates = templatesQuery.data ?? [];

  return (
    <div
      style={{
        position: "absolute",
        top: 12,
        left: 12,
        zIndex: 20,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid var(--color-border)",
          backgroundColor: "var(--color-surface)",
          color: "var(--color-text)",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
        }}
      >
        模板
      </button>

      {open && (
        <div
          style={{
            marginTop: 6,
            minWidth: 260,
            maxWidth: 320,
            borderRadius: 10,
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            padding: 6,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {templatesQuery.isLoading && (
            <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--color-text-muted)" }}>
              加载模板…
            </div>
          )}
          {templates.map((t) => (
            <button
              key={t.id}
              disabled={instantiate.isPending}
              onClick={() => handlePick(t.id, t.name)}
              style={{
                textAlign: "left",
                padding: "8px 10px",
                borderRadius: 8,
                border: "1px solid transparent",
                backgroundColor: "transparent",
                cursor: instantiate.isPending ? "wait" : "pointer",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.backgroundColor = "var(--color-surface-2)";
                e.currentTarget.style.borderColor = "var(--color-border)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.backgroundColor = "transparent";
                e.currentTarget.style.borderColor = "transparent";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    fontSize: 10,
                    padding: "1px 8px",
                    borderRadius: 999,
                    color: CATEGORY_COLOR[t.category] ?? "var(--color-ink-subtle)",
                    backgroundColor: `color-mix(in srgb, ${CATEGORY_COLOR[t.category] ?? "var(--color-ink-subtle)"} 13%, transparent)`,
                  }}
                >
                  {CATEGORY_LABEL[t.category] ?? t.category}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)" }}>
                  {t.name}
                </span>
                <span style={{ fontSize: 10, color: "var(--color-text-dim)", marginLeft: "auto" }}>
                  {t.nodeCount} 节点
                </span>
              </div>
              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                {t.description}
              </span>
            </button>
          ))}
          {templates.length === 0 && !templatesQuery.isLoading && (
            <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--color-text-muted)" }}>
              暂无可用模板
            </div>
          )}
        </div>
      )}
    </div>
  );
}
