import type {AgentEvent, ChatState, Message} from './types';

export function createChatState(messages: Message[] = []): ChatState {
  return {messages, busy: false, turnId: '', promptTokens: 0};
}

export function appendLocalUser(state: ChatState, text: string): ChatState {
  return {
    ...state,
    busy: true,
    messages: [...state.messages, {id: `local-user-${Date.now()}`, role: 'user', text}],
  };
}

export function composeAgentPrompt(text: string, workspaceUploads: string[] = []) {
  const message = text.replace(/\s+/g, ' ').trim();
  const paths = workspaceUploads.map((path) => path.trim()).filter(Boolean);
  if (paths.length === 0) return message;
  return `${message} <workspace_uploads>${JSON.stringify(paths)}</workspace_uploads>`;
}

export function applyAgentEvent(state: ChatState, event: AgentEvent): ChatState {
  const turnId = event.turn_id || state.turnId || `turn-${Date.now()}`;
  switch (event.type) {
    case 'turn':
      return {...state, busy: true, turnId};
    case 'prompt_trace': {
      const tokens = event.prompt_trace?.totals?.total_tokens
        ?? event.prompt_trace?.totals?.total_estimated_tokens
        ?? event.prompt_trace?.total_estimated_tokens
        ?? state.promptTokens;
      return {...state, promptTokens: Math.max(0, Math.round(tokens))};
    }
    case 'token':
      return appendAssistantDelta(state, turnId, event.delta || '');
    case 'tool_start': {
      const name = event.tool?.name || event.tool?.requested_name || 'tool';
      return upsertActivity(state, {
        id: activityId(turnId, event.tool?.id, name),
        role: 'activity',
        tool: name,
        status: 'running',
        stage: 'starting',
        text: 'Starting',
      });
    }
    case 'tool_progress': {
      const name = event.tool?.name || event.tool?.requested_name || 'tool';
      return upsertLatestToolActivity(state, name, {
        role: 'activity',
        tool: name,
        status: 'running',
        stage: event.progress?.stage || 'running',
        text: event.progress?.message || humanize(event.progress?.stage || 'Running'),
      });
    }
    case 'tool_result': {
      const name = event.tool_result?.name || 'tool';
      const ok = event.tool_result?.ok !== false;
      return upsertLatestToolActivity(state, name, {
        role: 'activity',
        tool: name,
        status: ok ? 'done' : 'error',
        stage: ok ? 'completed' : 'failed',
        text: ok ? 'Completed' : cleanError(event.tool_result?.content || 'Tool failed'),
      });
    }
    case 'terminal':
      if (event.stream !== 'stderr') return state;
      return {
        ...state,
        messages: [...state.messages, {
          id: `terminal-${Date.now()}`,
          role: 'activity',
          status: 'error',
          tool: 'runtime',
          text: cleanError(event.line || 'Runtime error'),
        }],
      };
    case 'error':
      return {
        ...state,
        busy: false,
        messages: [...state.messages, {id: `error-${turnId}-${Date.now()}`, role: 'error', text: event.message || 'Unknown agent error'}],
      };
    case 'done': {
      const hasAssistant = state.messages.some((message) => message.id === `assistant-${turnId}`);
      const messages = !hasAssistant && event.assistant
        ? [...state.messages, {id: `assistant-${turnId}`, role: 'assistant' as const, text: event.assistant}]
        : state.messages;
      return {...state, messages, busy: false};
    }
    case 'bridge_status':
      if (event.status !== 'error' && event.status !== 'stopped') return state;
      return {
        ...state,
        busy: false,
        messages: state.messages.map((message) => message.role === 'activity' && message.status === 'running'
          ? {...message, status: 'error', stage: 'interrupted', text: event.message || 'Generation stopped'}
          : message),
      };
    default:
      return state;
  }
}

function appendAssistantDelta(state: ChatState, turnId: string, delta: string): ChatState {
  if (!delta) return state;
  const id = `assistant-${turnId}`;
  const index = state.messages.findIndex((message) => message.id === id);
  if (index < 0) {
    return {...state, messages: [...state.messages, {id, role: 'assistant', text: delta}]};
  }
  const messages = [...state.messages];
  messages[index] = {...messages[index], text: `${messages[index].text}${delta}`};
  return {...state, messages};
}

function upsertActivity(state: ChatState, message: Message): ChatState {
  const index = state.messages.findIndex((item) => item.id === message.id);
  if (index < 0) return {...state, messages: [...state.messages, message]};
  const messages = [...state.messages];
  messages[index] = {...messages[index], ...message};
  return {...state, messages};
}

function upsertLatestToolActivity(state: ChatState, tool: string, update: Omit<Message, 'id'>): ChatState {
  const messages = [...state.messages];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'activity' && messages[index].tool === tool && messages[index].status === 'running') {
      messages[index] = {...messages[index], ...update};
      return {...state, messages};
    }
  }
  return {...state, messages: [...messages, {id: `activity-${tool}-${Date.now()}`, ...update}]};
}

function activityId(turnId: string, toolId: string | undefined, name: string) {
  return `activity-${turnId}-${toolId || name}-${Date.now()}`;
}

export function humanize(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bVimax\b/g, 'ViMax');
}

function cleanError(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}
