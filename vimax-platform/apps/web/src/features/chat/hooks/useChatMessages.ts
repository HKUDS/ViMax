"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  AgentMessage,
  CanvasMutation,
  ServerWsMessage,
} from "@vimax/contracts";
import { useCanvasWebSocket } from "@/lib/websocket/client";
import { trpc } from "@/lib/trpc/client";
import {
  applyServerChatEvent,
  createInitialChatStreamState,
} from "../chat-state";

// 鈹€鈹€ Chat Messages Hook 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// Manages the full chat state for a canvas: conversations, messages,
// WebSocket events, and streaming deltas.

interface UseChatMessagesOptions {
  canvasId: string;
  /** Initial conversation ID (e.g. from GenerationOverlay) */
  initialConversationId?: string;
  /** Called when agent sends a canvas mutation */
  onCanvasMutation?: (mutation: CanvasMutation) => void;
  /** Selected text model ID to send with each chat message */
  modelId?: string;
}

interface UseChatMessagesReturn {
  /** All messages in the current conversation */
  messages: AgentMessage[];
  /** Currently active conversation ID */
  conversationId: string | null;
  /** Is a message currently being streamed */
  isStreaming: boolean;
  /** The streaming content accumulated so far */
  streamingContent: string;
  /** Thinking content from the agent */
  thinkingContent: string | null;
  /** WebSocket connection status */
  wsStatus: "connecting" | "connected" | "disconnected" | "error";
  /** Send a user message */
  sendMessage: (content: string) => void;
  /** Create a new conversation */
  createConversation: () => Promise<void>;
  /** Switch to an existing conversation */
  switchConversation: (id: string) => void;
  /** Stop current streaming */
  stopStreaming: () => void;
  /** List of conversations */
  conversations: { id: string; title: string | null; updatedAt: string }[];
}

export function useChatMessages({
  canvasId,
  initialConversationId,
  onCanvasMutation,
  modelId,
}: UseChatMessagesOptions): UseChatMessagesReturn {
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId ?? null);
  const [chatState, setChatState] = useState(createInitialChatStreamState);

  // tRPC mutations
  const createConvMutation = trpc.chat.createConversation.useMutation();

  // tRPC queries
  const { data: conversationsData } =
    trpc.chat.listConversations.useQuery(
      { canvasId },
      { enabled: !!canvasId },
    );

  const { data: messagesData } = trpc.chat.getMessages.useQuery(
    { conversationId: conversationId! },
    { enabled: !!conversationId },
  );

  // Sync messages from tRPC (initial load)
  useEffect(() => {
    if (messagesData?.items) {
      setChatState((prev) => ({
        ...prev,
        messages: messagesData.items,
      }));
    }
  }, [messagesData]);

  useEffect(() => {
    setChatState((prev) => ({
      ...prev,
      conversationId,
    }));
  }, [conversationId]);

  // Auto-select first conversation if one already exists
  useEffect(() => {
    if (
      conversationsData?.items &&
      conversationsData.items.length > 0 &&
      !conversationId
    ) {
      setConversationId(conversationsData.items[0]!.id);
    }
  }, [conversationsData, conversationId]);

  // WebSocket message handler
  const handleWsMessage = useCallback(
    (msg: ServerWsMessage) => {
      if (
        "conversationId" in msg &&
        msg.conversationId !== conversationId
      ) {
        return; // Ignore messages for other conversations
      }

      switch (msg.type) {
        case "chat.message":
        case "chat.thinking":
        case "chat.delta":
        case "chat.complete":
        case "chat.error": {
          setChatState((prev) => applyServerChatEvent(prev, msg));
          if (msg.type === "chat.error") {
            console.error("[chat] Error:", msg.error);
          }
          break;
        }

        case "chat.tool_call": {
          // Log tool call for display
          console.log("[chat] Tool call:", msg.tool.name, msg.tool.args);
          setChatState((prev) => ({
            ...prev,
            streamingContent:
              prev.streamingContent + `\n\n正在执行: ${msg.tool.name}...`,
          }));
          break;
        }

        case "chat.tool_result": {
          // Display tool result
          const ok = msg.tool.status === "completed";
          console.log("[chat] Tool result:", msg.tool.name, msg.tool.status);
          setChatState((prev) => ({
            ...prev,
            streamingContent:
              prev.streamingContent + `\n${msg.tool.name}: ${ok ? "完成" : "失败"}`,
          }));
          break;
        }

        case "chat.canvas_mutation": {
          console.log("[chat] Canvas mutation:", msg.mutation.type);
          onCanvasMutation?.(msg.mutation);
          break;
        }
      }
    },
    [conversationId, onCanvasMutation],
  );

  // WebSocket connection
  const { send, status: wsStatus } = useCanvasWebSocket({
    canvasId,
    onMessage: handleWsMessage,
    enabled: !!canvasId,
  });

  // Send a user message
  const sendMessage = useCallback(
    (content: string) => {
      console.log("[useChatMessages] sendMessage called", { conversationId, wsConnected: !!conversationId });
      if (!conversationId) return;

      setChatState((prev) => ({
        ...prev,
        isStreaming: true,
        streamingContent: "",
        thinkingContent: null,
      }));

      send({
        type: "chat.send",
        conversationId,
        content,
        modelId,
      });
    },
    [conversationId, modelId, send],
  );

  // Create a new conversation
  const createConversation = useCallback(async () => {
    try {
      const result = await createConvMutation.mutateAsync({
        canvasId,
        title: undefined,
      });
      setConversationId(result.conversation.id);
      setChatState({
        ...createInitialChatStreamState(),
        conversationId: result.conversation.id,
      });
    } catch (err) {
      console.error("[chat] Failed to create conversation:", err);
    }
  }, [canvasId, createConvMutation]);

  // Switch to an existing conversation
  const switchConversation = useCallback((id: string) => {
    setConversationId(id);
    setChatState({
      ...createInitialChatStreamState(),
      conversationId: id,
    });
  }, []);

  // Stop current streaming
  const stopStreaming = useCallback(() => {
    if (!conversationId) return;
    send({ type: "chat.stop", conversationId });
    setChatState((prev) => ({
      ...prev,
      isStreaming: false,
      streamingContent: "",
      thinkingContent: null,
    }));
  }, [conversationId, send]);

  return {
    messages: chatState.messages,
    conversationId,
    isStreaming: chatState.isStreaming,
    streamingContent: chatState.streamingContent,
    thinkingContent: chatState.thinkingContent,
    wsStatus,
    sendMessage,
    createConversation,
    switchConversation,
    stopStreaming,
    conversations:
      conversationsData?.items.map((c) => ({
        id: c.id,
        title: c.title,
        updatedAt: c.updatedAt,
      })) ?? [],
  };
}
