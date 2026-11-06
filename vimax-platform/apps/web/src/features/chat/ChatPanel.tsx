"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasMutation, AgentMessage } from "@vimax/contracts";
import type { Node } from "@xyflow/react";
import { cn } from "@vimax/ui";
import { toast } from "sonner";
import {
  Brain,
  ChevronDown,
  History,
  Paperclip,
  Plus,
  SendHorizontal,
  Sparkles,
  Square,
} from "lucide-react";
import { markPromptSent, wasPromptSent } from "@/lib/prompt-dedup";
import { useSandboxRunner } from "@/features/sandbox/useSandboxRunner";
import { useChatMessages } from "./hooks/useChatMessages";
import { Markdown } from "./Markdown";
import { ModelSelect } from "@/features/models/ModelSelect";
import { PipelineStepper } from "@/features/canvas/components/PipelineStepper";
import { NODE_TYPE_VISUALS } from "@/features/canvas/constants/node-visuals";
import type { AutoPipelineState } from "@/features/canvas/hooks/useAutoPipeline";

interface ChatPanelProps {
  canvasId: string;
  onCanvasMutation?: (mutation: CanvasMutation) => void;
  visible: boolean;
  defaultTextModelId?: string;
  initialPrompt?: string;
  initialMode?: string;
  nodes?: Node[];
  autoPipelineState?: AutoPipelineState;
  retryFailedNodes?: () => void;
  startAutoPipeline?: (scriptNodeId?: string) => Promise<string | undefined>;
  cancelAutoPipeline?: () => void;
  /** Node ids most recently created by the agent — rendered as jump chips. */
  recentNodeIds?: string[];
  selectedNodeIds?: string[];
  onFocusNode?: (nodeId: string) => void;
}

const WS_STATUS = {
  connected: { label: "已连接", color: "var(--color-success)" },
  connecting: { label: "连接中…", color: "var(--color-warning)" },
  disconnected: { label: "未连接", color: "var(--color-danger)" },
} as const;

/** 空态建议指令：完整短句，点击即填入输入框 */
const SUGGESTED_PROMPTS = [
  "写一个关于时间旅行的短片剧本",
  "为女主角生成一张角色肖像",
  "改成赛博朋克风格重新分镜",
] as const;

// ── Chat Panel Component ────────────────────────────────────────────
// Right-side panel that provides an AI chat interface for the canvas.

export function ChatPanel({
  canvasId,
  onCanvasMutation,
  visible,
  defaultTextModelId,
  initialPrompt,
  initialMode,
  nodes = [],
  autoPipelineState,
  startAutoPipeline,
  cancelAutoPipeline,
  retryFailedNodes,
  recentNodeIds = [],
  selectedNodeIds = [],
  onFocusNode,
}: ChatPanelProps) {
  const [modelId, setModelId] = useState(defaultTextModelId ?? "");
  const [autoMode, setAutoMode] = useState(() => {
    if (typeof window === "undefined") return false;
    // Auto mode is the product default (灵感模式 = 一句话全自动出片);
    // an explicit opt-out ("0") is the only way to turn it off.
    return localStorage.getItem("vimax:auto-mode") !== "0";
  });

  const {
    messages,
    conversationId,
    isStreaming,
    streamingContent,
    thinkingContent,
    wsStatus,
    sendMessage,
    createConversation,
    switchConversation,
    stopStreaming,
    conversations,
  } = useChatMessages({
    canvasId,
    onCanvasMutation,
    modelId,
  });

  const [inputValue, setInputValue] = useState("");
  // 订阅 sandbox.run_requested（执行状态在 sandbox runner 内部，暂无 UI 消费）
  useSandboxRunner(canvasId);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [showConvList, setShowConvList] = useState(false);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, thinkingContent]);

  // Auto-send initial prompt from home page (once only, skip if overlay already sent)
  const initialSentRef = useRef(false);
  useEffect(() => {
    if (initialSentRef.current) return;
    if (!initialPrompt || !conversationId) return;
    if (wasPromptSent(canvasId, initialPrompt)) return;
    initialSentRef.current = true;

    const prefix = initialMode === "idea"
      ? "【灵感模式】请根据以下创意想法，自动完成编剧、分镜、生成视频的准备：\n\n"
      : initialMode === "script"
        ? "【剧本模式】请根据以下剧本内容，自动完成分镜和视频生成的准备：\n\n"
        : "";
    sendMessage(prefix + initialPrompt);
  }, [canvasId, conversationId, initialPrompt, initialMode, sendMessage]);

  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming && autoMode && startAutoPipeline) {
      const script = nodes.find((n) => n.type === "script");
      if (script) {
        startAutoPipeline(script.id).catch((err: unknown) => {
          const msg = (err as Error).message || "启动失败";
          toast.error(
            msg.includes("already_running") ? "该画布已有出片任务在运行，请等待完成" : msg.slice(0, 80),
          );
        });
      }
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming, autoMode, startAutoPipeline, nodes]);

  const toggleAutoMode = useCallback(() => {
    setAutoMode((prev) => {
      const next = !prev;
      localStorage.setItem("vimax:auto-mode", next ? "1" : "0");
      return next;
    });
  }, []);

  // Handle send
  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || (!conversationId && !isStreaming)) return;

    if (!conversationId) {
      // Will create conversation first, then send
      createConversation().then(() => sendMessage(text));
    } else {
      sendMessage(text);
    }
    setInputValue("");

    // Refocus input
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [inputValue, conversationId, isStreaming, sendMessage, createConversation]);

  // Handle Enter key
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  if (!visible) return null;

  const ws = WS_STATUS[wsStatus as keyof typeof WS_STATUS] ?? WS_STATUS.disconnected;

  return (
    <div className="flex h-full w-[380px] shrink-0 flex-col overflow-hidden border-l border-[var(--color-hairline)] bg-[var(--color-surface)]">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-hairline)] px-3.5 py-2.5">
        <span className="flex-1 text-[13px] font-semibold text-[var(--color-ink)]">AI 助手</span>

        <button
          type="button"
          onClick={toggleAutoMode}
          title={autoMode ? "自动模式：Chat 完成后自动跑全流程" : "手动模式：需点击「全自动出片」"}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
            autoMode
              ? "border-[var(--color-accent)] bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
              : "border-[var(--color-hairline)] text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]",
          )}
        >
          <Sparkles className="size-2.5" />
          {autoMode ? "自动" : "手动"}
        </button>

        <ModelSelect
          type="text"
          value={modelId}
          onChange={setModelId}
          compact
          placeholder="模型"
        />

        <span className="inline-flex items-center gap-1.5 text-[10px]" style={{ color: ws.color }}>
          <span className="size-1.5 rounded-full" style={{ backgroundColor: ws.color }} />
          {ws.label}
        </span>

        <button
          type="button"
          onClick={async () => {
            await createConversation();
          }}
          title="新建会话"
          className="inline-flex items-center gap-1 rounded-md p-1.5 text-[var(--color-ink-subtle)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {autoPipelineState && (
        <PipelineStepper
          state={autoPipelineState}
          onCancel={cancelAutoPipeline}
          onRetryFailed={retryFailedNodes}
        />
      )}

      {/* ── Conversation list (collapsible) ── */}
      {conversations.length > 1 && (
        <div className="shrink-0 border-b border-[var(--color-hairline)]">
          <button
            type="button"
            onClick={() => setShowConvList(!showConvList)}
            className="flex w-full items-center gap-1.5 px-3.5 py-1.5 text-left text-[10px] text-[var(--color-ink-subtle)] transition-colors hover:text-[var(--color-ink)]"
          >
            <History className="size-3" />
            历史会话 ({conversations.length})
            <ChevronDown className={cn("size-3 transition-transform", showConvList && "rotate-180")} />
          </button>

          {showConvList && (
            <div className="max-h-[120px] overflow-y-auto border-t border-[var(--color-hairline)]">
              {conversations.map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  disabled={isStreaming}
                  title={isStreaming ? "生成中，暂不能切换会话" : "切换到此会话"}
                  onClick={() => {
                    if (isStreaming || conv.id === conversationId) return;
                    switchConversation(conv.id);
                    setShowConvList(false);
                  }}
                  className={cn(
                    "block w-full cursor-pointer truncate border-b border-[var(--color-hairline)] px-3.5 py-1.5 text-left text-[11px] transition-colors last:border-b-0 disabled:cursor-not-allowed disabled:opacity-60",
                    conv.id === conversationId
                      ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                      : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]",
                  )}
                >
                  {conv.title ?? `会话 ${conv.id.slice(0, 8)}…`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Messages area ── */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 py-2.5">
        {/* Empty state */}
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 py-8 text-center">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--color-accent-subtle)] text-[var(--color-accent)]">
              <Sparkles className="size-4.5" />
            </span>
            <span className="text-[13px] font-medium text-[var(--color-ink)]">AI 助手准备就绪</span>
            <span className="text-[11px] text-[var(--color-ink-subtle)]">输入指令开始创作，或试试：</span>
            <div className="mt-3 flex max-w-full flex-col items-center gap-1.5 text-[10px] text-[var(--color-ink-subtle)]">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => {
                    setInputValue(prompt);
                    inputRef.current?.focus();
                  }}
                  title="点击填入输入框"
                  className="max-w-full truncate rounded-full border border-[var(--color-hairline)] px-2.5 py-1 transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-accent-subtle)] hover:text-[var(--color-accent)]"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Message list */}
        {messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}

        {/* Thinking block */}
        {thinkingContent && (
          <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-3 py-2 text-[11px] leading-relaxed">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-[var(--color-ink-subtle)]">
              <Brain className="size-3" />
              思考中…
            </div>
            <div className="whitespace-pre-wrap text-[var(--color-ink-muted)]">{thinkingContent}</div>
          </div>
        )}

        {/* Streaming message */}
        {isStreaming && streamingContent && (
          <div className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-3 py-2.5 text-[12px] leading-relaxed whitespace-pre-wrap text-[var(--color-ink)]">
            {streamingContent}
            <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-blink bg-[var(--color-accent)] align-text-bottom" />
          </div>
        )}

        {/* Streaming indicator (no content yet) */}
        {isStreaming && !streamingContent && !thinkingContent && (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-3 py-2.5">
            <div className="chat-typing-dots">
              <span /><span /><span />
            </div>
            <span className="text-[11px] text-[var(--color-ink-muted)]">AI 正在思考…</span>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Agent-created node chips: click to focus on canvas ── */}
      {recentNodeIds.length > 0 && onFocusNode && (
        <div className="flex shrink-0 gap-1.5 overflow-x-auto border-t border-[var(--color-hairline)] px-3.5 py-2">
          {recentNodeIds.map((nodeId) => {
            const node = nodes.find((n) => n.id === nodeId);
            if (!node) return null;
            const data = node.data as Record<string, unknown>;
            const label =
              (data.content as string) ??
              (data.prompt as string) ??
              (data.ffDesc as string) ??
              (data.name as string) ??
              "";
            const typeLabel = NODE_TYPE_VISUALS[node.type as keyof typeof NODE_TYPE_VISUALS]?.label ?? node.type;
            return (
              <button
                key={nodeId}
                type="button"
                title="点击在画布上定位该节点"
                onClick={() => onFocusNode(nodeId)}
                className="shrink-0 whitespace-nowrap rounded-full border border-[var(--color-accent)] bg-[var(--color-accent-subtle)] px-2.5 py-0.5 text-[10px] font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent-muted)]"
              >
                {typeLabel} {label.slice(0, 12)}{label.length > 12 ? "…" : ""}
              </button>
            );
          })}
        </div>
      )}

      {/* ── Input area ── */}
      <div className="flex relative items-end gap-2 border-t border-[var(--color-hairline)] px-3.5 py-2.5">
        <div className="flex flex-1 flex-col gap-1.5">
          {selectedNodeIds.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const quoted = selectedNodeIds
                  .map((id) => {
                    const node = nodes.find((n) => n.id === id);
                    if (!node) return null;
                    const data = node.data as Record<string, unknown>;
                    const text =
                      (data.content as string) ??
                      (data.prompt as string) ??
                      (data.ffDesc as string) ??
                      (data.name as string) ??
                      "";
                    return `- [${node.type}] ${text.slice(0, 80)}`;
                  })
                  .filter(Boolean)
                  .join("\n");
                setInputValue(
                  (prev) =>
                    (prev ? `${prev}\n` : "") +
                    `请参考以下选中的画布节点：\n${quoted}\n`,
                );
                inputRef.current?.focus();
              }}
              className="inline-flex items-center gap-1 self-start rounded-full border border-[var(--color-hairline-strong)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]"
            >
              <Paperclip className="size-2.5" />
              引用选中节点 ({selectedNodeIds.length})
            </button>
          )}
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              conversationId ? "输入指令… (Enter 发送, Shift+Enter 换行)" : "点击「新会话」开始…"
            }
            disabled={!conversationId && !isStreaming}
            rows={1}
            className="max-h-[120px] w-full flex-1 resize-none rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-2.5 py-2 text-[12px] leading-relaxed text-[var(--color-ink)] outline-none transition-colors placeholder:text-[var(--color-ink-tertiary)] focus:border-[var(--color-accent)] disabled:opacity-60"
          />
        </div>
        {isStreaming ? (
          <button
            type="button"
            onClick={stopStreaming}
            title="停止生成"
            className="flex items-center justify-center rounded-lg border border-[var(--color-danger)] p-2.5 text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-subtle)]"
          >
            <Square className="size-3.5" />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!inputValue.trim() || !conversationId}
            title="发送消息 (Enter)"
            aria-label="发送消息"
            className={cn(
              "flex items-center justify-center rounded-lg p-2.5 transition-colors absolute",
              inputValue.trim() && conversationId
                ? "bg-[var(--color-accent)] text-[var(--color-accent-on)] hover:bg-[var(--color-accent-hover)]"
                : "border border-[var(--color-hairline)] text-[var(--color-ink-tertiary)]",
            )}
          >
            <SendHorizontal className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Chat Message Bubble ─────────────────────────────────────────────

function ChatMessageBubble({ message }: { message: AgentMessage }) {
  const isUser = message.role === "user";
  const [expanded, setExpanded] = useState(false);

  // Extract tool calls and thinking from metadata
  const metadata = message.metadata as Record<string, unknown>;
  const toolCalls = (metadata?.toolCalls ?? []) as Array<{
    name: string;
    status: string;
  }>;
  const thinking = metadata?.thinking as string | undefined;

  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      {/* Role label */}
      <span className="px-1 text-[9px] font-semibold tracking-wide text-[var(--color-ink-tertiary)]">
        {isUser ? "你" : "AI"}
      </span>

      {/* Message bubble */}
      <div
        className={cn(
          "max-w-[90%] px-3 py-2 text-[12px] leading-relaxed break-words",
          isUser
            ? "rounded-xl rounded-br-sm bg-[var(--color-accent)] text-[var(--color-accent-on)]"
            : "rounded-xl rounded-bl-sm border border-[var(--color-hairline)] bg-[var(--color-surface-2)] text-[var(--color-ink)]",
        )}
      >
        {isUser ? (
          <span className="whitespace-pre-wrap">{message.content}</span>
        ) : (
          <Markdown content={message.content} />
        )}
      </div>

      {/* Thinking (collapsible) */}
      {thinking && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] text-[var(--color-ink-subtle)] transition-colors hover:text-[var(--color-ink)]"
        >
          <Brain className="size-2.5" />
          {expanded ? "隐藏" : "显示"}推理过程
        </button>
      )}
      {thinking && expanded && (
        <div className="max-w-[90%] whitespace-pre-wrap rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[10px] leading-relaxed text-[var(--color-ink-muted)]">
          {thinking}
        </div>
      )}

      {/* Tool calls */}
      {toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {toolCalls.map((tc, i) => {
            const statusColor =
              tc.status === "completed" ? "var(--color-success)" :
              tc.status === "running" ? "var(--color-ai-thinking)" :
              tc.status === "failed" ? "var(--color-ai-error)" :
              "var(--color-ink-subtle)";
            return (
              <span
                key={i}
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.06em]"
                style={{ color: statusColor, borderColor: statusColor }}
              >
                {tc.name}
              </span>
            );
          })}
        </div>
      )}

      {/* Timestamp */}
      <span className="px-1 text-[9px] text-[var(--color-ink-tertiary)]">
        {new Date(message.createdAt).toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </span>
    </div>
  );
}
