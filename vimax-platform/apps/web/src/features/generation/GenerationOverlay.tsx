"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { CanvasMutation } from "@vimax/contracts";
import { markPromptSent } from "@/lib/prompt-dedup";
import { useChatMessages } from "../chat/hooks/useChatMessages";
import { Markdown } from "../chat/Markdown";
import { Button } from "@vimax/ui";

// ── Props ──────────────────────────────────────────────────────────

interface GenerationOverlayProps {
  open: boolean;
  canvasId: string;
  conversationId: string;
  prompt: string;
  mode: "idea" | "script";
  modelId?: string;
  onClose: () => void;
  onNavigate: (canvasId: string) => void;
}

// ── Generation Overlay ─────────────────────────────────────────────
// Full-screen overlay shown on the home page after clicking "generate".
// Displays the AI streaming response, tool calls, and canvas mutations
// in real time. User can navigate to the canvas when done.

export function GenerationOverlay({
  open,
  canvasId,
  conversationId,
  prompt,
  mode,
  modelId,
  onClose,
  onNavigate,
}: GenerationOverlayProps) {
  // Track canvas mutations to show a summary
  const [mutations, setMutations] = useState<CanvasMutation[]>([]);
  const [toolCalls, setToolCalls] = useState<
    Array<{ name: string; status: string }>
  >([]);
  const [isComplete, setIsComplete] = useState(false);

  const handleCanvasMutation = useCallback(
    (mutation: CanvasMutation) => {
      setMutations((prev) => [...prev, mutation]);
    },
    [],
  );

  const {
    messages,
    isStreaming,
    streamingContent,
    thinkingContent,
    wsStatus,
    sendMessage,
    stopStreaming,
  } = useChatMessages({
    canvasId,
    initialConversationId: conversationId,
    onCanvasMutation: handleCanvasMutation,
    modelId,
  });

  // Auto-send the prompt when WebSocket is connected and conversation is ready
  const sentRef = useRef(false);
  useEffect(() => {
    if (sentRef.current) return;
    if (!conversationId) return;
    if (wsStatus !== "connected") return;
    sentRef.current = true;
    markPromptSent(canvasId, prompt);

    const prefix =
      mode === "idea"
        ? "【灵感模式】请根据以下创意想法，自动完成编剧、分镜、生成视频的准备：\n\n"
        : mode === "script"
          ? "【剧本模式】请根据以下剧本内容，自动完成分镜和视频生成的准备：\n\n"
          : "";
    sendMessage(prefix + prompt);
  }, [conversationId, prompt, mode, sendMessage, wsStatus]);

  // Track completion — only mark complete when canvas has actual content
  useEffect(() => {
    if (!isStreaming && messages.length > 1 && sentRef.current) {
      const hasAssistant = messages.some((m) => m.role === "assistant");
      const hasNodes = mutations.some((m) => m.type === "nodes.add");
      if (hasAssistant && hasNodes) setIsComplete(true);
    }
  }, [isStreaming, messages, mutations]);

  // Track tool calls from messages metadata
  useEffect(() => {
    const assistantMsgs = messages.filter((m) => m.role === "assistant");
    if (assistantMsgs.length === 0) return;
    const last = assistantMsgs[assistantMsgs.length - 1];
    const metadata = last.metadata as Record<string, unknown> | undefined;
    const tc = (metadata?.toolCalls ?? []) as Array<{
      name: string;
      status: string;
    }>;
    if (tc.length > 0) setToolCalls(tc);
  }, [messages]);

  // Auto-scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [streamingContent, thinkingContent, messages]);

  if (!open) return null;

  // Collect node types from mutations
  const createdNodeTypes = mutations
    .filter((m) => m.type === "nodes.add")
    .flatMap((m) =>
      "nodes" in m ? m.nodes.map((n: { type: string }) => n.type) : [],
    );

  const NODE_LABELS: Record<string, string> = {
    script: "剧本",
    character: "角色",
    storyboard_cell: "分镜",
    shot: "镜头",
    image: "图片",
    video: "视频",
    concat: "合成",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          height: "85vh",
          backgroundColor: "var(--color-canvas)",
          borderRadius: 16,
          border: "1px solid var(--color-hairline)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 60px rgba(0,0,0,0.5)",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            flexShrink: 0,
            padding: "16px 20px",
            borderBottom: "1px solid var(--color-hairline)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "var(--color-ink)",
              }}
            >
              {isComplete
                ? "创作完成"
                : isStreaming
                  ? "AI 正在创作…"
                  : "准备中…"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Connection indicator */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color:
                  wsStatus === "connected"
                    ? "var(--color-success)"
                    : wsStatus === "connecting"
                      ? "var(--color-warning)"
                      : "var(--color-danger)",
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor:
                    wsStatus === "connected"
                      ? "var(--color-success)"
                      : wsStatus === "connecting"
                        ? "var(--color-warning)"
                        : "var(--color-danger)",
                }}
              />
              {wsStatus === "connected"
                ? "已连接"
                : wsStatus === "connecting"
                  ? "连接中…"
                  : "未连接"}
            </div>
            <button
              onClick={onClose}
              aria-label="关闭"
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: "1px solid var(--color-hairline)",
                backgroundColor: "transparent",
                color: "var(--color-ink-subtle)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* ── Content area ── */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {/* User message */}
          <div
            style={{
              alignSelf: "flex-end",
              maxWidth: "85%",
              padding: "10px 16px",
              borderRadius: "14px 14px 4px 14px",
              backgroundColor: "var(--color-accent)",
              color: "#fff",
              fontSize: 13,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
            }}
          >
            {prompt}
          </div>

          {/* Thinking block */}
          {thinkingContent && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                backgroundColor: "var(--color-surface-2)",
                border: "1px solid var(--color-hairline)",
                fontSize: 12,
                color: "var(--color-ai-reading)",
                lineHeight: 1.5,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  marginBottom: 4,
                  fontSize: 10,
                  fontWeight: 600,
                }}
              >
                思考中…
              </div>
              <div style={{ whiteSpace: "pre-wrap", opacity: 0.8 }}>
                {thinkingContent}
              </div>
            </div>
          )}

          {/* Streaming / completed assistant message */}
          {(streamingContent || messages.some((m) => m.role === "assistant")) && (
            <div
              style={{
                alignSelf: "flex-start",
                maxWidth: "90%",
                padding: "12px 16px",
                borderRadius: "14px 14px 14px 4px",
                backgroundColor: "var(--color-surface-1)",
                border: "1px solid var(--color-hairline)",
                fontSize: 13,
                lineHeight: 1.7,
                color: "var(--color-ink)",
              }}
            >
              {streamingContent ? (
                <>
                  <Markdown content={streamingContent} />
                  <span
                    style={{
                      display: "inline-block",
                      width: 2,
                      height: 14,
                      backgroundColor: "var(--color-accent)",
                      marginLeft: 2,
                      verticalAlign: "text-bottom",
                      animation: "blink 1s infinite",
                    }}
                  />
                </>
              ) : (
                messages
                  .filter((m) => m.role === "assistant")
                  .map((m) => <Markdown key={m.id} content={m.content} />)
              )}
            </div>
          )}

          {/* Streaming indicator (no content yet) */}
          {isStreaming && !streamingContent && !thinkingContent && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                backgroundColor: "var(--color-surface-1)",
                border: "1px solid var(--color-hairline)",
                display: "flex",
                gap: 6,
                alignItems: "center",
                fontSize: 12,
                color: "var(--color-ink-subtle)",
              }}
            >
              <div className="chat-typing-dots">
                <span />
                <span />
                <span />
              </div>
              AI 正在思考…
            </div>
          )}

          {/* Tool calls */}
          {toolCalls.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {toolCalls.map((tc, i) => (
                <span
                  key={i}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 10px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    color:
                      tc.status === "completed"
                        ? "var(--color-success)"
                        : tc.status === "running"
                          ? "var(--color-node-running)"
                          : "var(--color-ink-subtle)",
                    border: `1px solid color-mix(in srgb, ${tc.status === "completed" ? "var(--color-success)" : tc.status === "running" ? "var(--color-node-running)" : "var(--color-ink-subtle)"} 45%, transparent)`,
                  }}
                >
                  {tc.name}
                </span>
              ))}
            </div>
          )}

          {/* Mutation summary */}
          {createdNodeTypes.length > 0 && (
            <div
              style={{
                padding: "10px 14px",
                borderRadius: 10,
                backgroundColor: "var(--color-success-subtle)",
                border: "1px solid color-mix(in srgb, var(--color-success) 25%, transparent)",
                fontSize: 12,
                color: "var(--color-success)",
                lineHeight: 1.5,
              }}
            >
              画布节点已创建：{" "}
              {createdNodeTypes
                .map((t: string) => NODE_LABELS[t] ?? t)
                .join("、")}
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            flexShrink: 0,
            padding: "14px 20px",
            borderTop: "1px solid var(--color-hairline)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 11, color: "var(--color-ink-subtle)" }}>
            {isStreaming
              ? "AI 正在处理中…"
              : isComplete
                ? `生成完成 · ${messages.length} 条消息 · ${mutations.length} 次画布更新`
                : "等待连接…"}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {isStreaming && (
              <Button
                onClick={stopStreaming}
                size="sm"
                variant="secondary"
              >
                停止
              </Button>
            )}
            <Button
              onClick={() => onNavigate(canvasId)}
              disabled={!isComplete && messages.length <= 1}
              size="sm"
            >
              进入画布
            </Button>
          </div>
        </div>
      </div>

      {/* Blink animation */}
      <style>{`@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }`}</style>
    </div>
  );
}
