import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage, ServerWsMessage } from "@vimax/contracts";
import {
  applyServerChatEvent,
  changedScriptIds,
  createInitialChatStreamState,
} from "./chat-state.js";

test("changedScriptIds selects only scripts created or edited during chat", () => {
  const before = new Map([["old", JSON.stringify({ content: "old" })]]);
  assert.deepEqual(changedScriptIds([
    { id: "old", type: "script", data: { content: "updated" } },
    { id: "new", type: "script", data: { content: "new" } },
    { id: "image", type: "image", data: { prompt: "new" } },
  ], before), ["old", "new"]);
});

test("changedScriptIds returns no target for an unrelated chat", () => {
  const data = { content: "unchanged" };
  const before = new Map([["script", JSON.stringify(data)]]);
  assert.deepEqual(changedScriptIds([{ id: "script", type: "script", data }], before), []);
});

function createMessage(
  overrides: Partial<AgentMessage> = {},
): AgentMessage {
  return {
    id: 1,
    conversationId: "conv-1",
    role: "assistant",
    content: "",
    metadata: {},
    status: "complete",
    createdAt: "2026-06-08T10:00:00.000Z",
    ...overrides,
  };
}

test("chat.message appends a persisted user message without clearing stream state", () => {
  const state = {
    ...createInitialChatStreamState(),
    conversationId: "conv-1",
    isStreaming: true,
    streamingContent: "draft assistant reply",
  };

  const nextState = applyServerChatEvent(
    state,
    {
      type: "chat.message",
      conversationId: "conv-1",
      message: createMessage({
        id: 11,
        role: "user",
        content: "hello",
      }),
    } satisfies ServerWsMessage,
  );

  assert.equal(nextState.isStreaming, true);
  assert.equal(nextState.streamingContent, "draft assistant reply");
  assert.deepEqual(nextState.messages.map((message) => message.role), ["user"]);
});

test("chat.complete uses the server-provided assistant message and resets stream buffers", () => {
  const state = {
    ...createInitialChatStreamState(),
    conversationId: "conv-1",
    isStreaming: true,
    streamingContent: "final answer",
    thinkingContent: "reasoning",
  };

  const nextState = applyServerChatEvent(
    state,
    {
      type: "chat.complete",
      conversationId: "conv-1",
      message: createMessage({
        id: 12,
        role: "assistant",
        content: "final answer",
        metadata: {
          toolCalls: [
            {
              id: "tool-1",
              name: "create_node",
              args: {},
              status: "completed",
            },
          ],
        },
      }),
    } satisfies ServerWsMessage,
  );

  assert.equal(nextState.isStreaming, false);
  assert.equal(nextState.streamingContent, "");
  assert.equal(nextState.thinkingContent, null);
  assert.deepEqual(nextState.messages.at(-1)?.metadata.toolCalls?.[0]?.name, "create_node");
});
