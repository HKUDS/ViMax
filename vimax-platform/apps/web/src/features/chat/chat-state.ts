import type { AgentMessage, ServerWsMessage } from "@vimax/contracts";

export interface ChatStreamState {
  conversationId: string | null;
  messages: AgentMessage[];
  isStreaming: boolean;
  streamingContent: string;
  thinkingContent: string | null;
}

export function createInitialChatStreamState(): ChatStreamState {
  return {
    conversationId: null,
    messages: [],
    isStreaming: false,
    streamingContent: "",
    thinkingContent: null,
  };
}

export function changedScriptIds(
  nodes: Array<{ id: string; type?: string; data?: unknown }>,
  before: ReadonlyMap<string, string>,
): string[] {
  return nodes
    .filter((node) => node.type === "script" && before.get(node.id) !== JSON.stringify(node.data))
    .map((node) => node.id);
}

function upsertMessage(
  messages: AgentMessage[],
  message: AgentMessage,
): AgentMessage[] {
  const existingIndex = messages.findIndex((item) => item.id === message.id);

  if (existingIndex === -1) {
    return [...messages, message];
  }

  return messages.map((item, index) =>
    index === existingIndex ? message : item,
  );
}

export function applyServerChatEvent(
  state: ChatStreamState,
  message: ServerWsMessage,
): ChatStreamState {
  switch (message.type) {
    case "chat.message":
      return {
        ...state,
        messages: upsertMessage(state.messages, message.message),
      };

    case "chat.thinking":
      return {
        ...state,
        thinkingContent: (state.thinkingContent ?? "") + message.content,
      };

    case "chat.delta":
      return {
        ...state,
        isStreaming: true,
        streamingContent: state.streamingContent + message.content,
      };

    case "chat.complete":
      return {
        ...state,
        isStreaming: false,
        streamingContent: "",
        thinkingContent: null,
        messages: upsertMessage(state.messages, message.message),
      };

    case "chat.error":
      return {
        ...state,
        isStreaming: false,
        streamingContent: "",
        thinkingContent: null,
      };

    default:
      return state;
  }
}
