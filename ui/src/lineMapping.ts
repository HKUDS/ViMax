import type {MappingState, StreamEvent, WorkspaceLine} from './types.js';

export function createMappingState(): MappingState {
  return {assistantStreaming: false};
}

export function appendUserLine(lines: WorkspaceLine[], text: string): {lines: WorkspaceLine[]; state: MappingState} {
  return {lines: [...lines, {kind: 'user', text}], state: createMappingState()};
}

export function applyStreamEvent(lines: WorkspaceLine[], state: MappingState, event: StreamEvent): {lines: WorkspaceLine[]; state: MappingState} {
  switch (event.type) {
    case 'turn':
    case 'status':
      return {lines, state};
    case 'token':
      return appendAssistantToken(lines, state, event.delta ?? '');
    case 'tool_start':
      return append(lines, state, {kind: 'tool', status: 'running', text: `tool ${event.tool?.name ?? 'unknown'} started`});
    case 'tool_progress':
      return append(lines, state, {
        kind: 'tool',
        status: 'running',
        text: compactJoin([`tool ${event.tool?.name ?? 'unknown'}`, event.progress?.stage, event.progress?.message]),
      });
    case 'tool_result': {
      const result = event.tool_result ?? {};
      const ok = result.ok !== false;
      const name = result.name ?? 'unknown';
      const detail = ok ? '' : cleanToolError(result.content);
      return append(lines, state, {kind: 'tool', status: ok ? 'done' : 'error', text: detail ? `tool ${name} error: ${detail}` : `tool ${name} ${ok ? 'done' : 'error'}`});
    }
    case 'terminal':
      return append(lines, state, {kind: 'terminal', text: compactJoin([event.stream ? `[${event.stream}]` : '', event.line])});
    case 'session':
      return {lines, state};
    case 'done':
      return {lines, state: createMappingState()};
    case 'error':
      return append(lines, state, {kind: 'error', text: event.message ?? 'Unknown error'});
    default:
      return {lines, state};
  }
}

function append(lines: WorkspaceLine[], state: MappingState, line: WorkspaceLine): {lines: WorkspaceLine[]; state: MappingState} {
  return {lines: [...lines, line], state: {...state, assistantStreaming: false}};
}

function appendAssistantToken(lines: WorkspaceLine[], state: MappingState, delta: string): {lines: WorkspaceLine[]; state: MappingState} {
  if (!delta) return {lines, state: {...state, assistantStreaming: true}};
  const next = [...lines];
  const last = next[next.length - 1];
  if (state.assistantStreaming && last?.kind === 'assistant') {
    next[next.length - 1] = {...last, text: `${last.text}${delta}`};
  } else {
    next.push({kind: 'assistant', text: delta});
  }
  return {lines: next, state: {assistantStreaming: true}};
}


function compactJoin(parts: Array<string | undefined | null>): string {
  return parts.map((part) => String(part ?? '').trim()).filter(Boolean).join(': ');
}


function cleanToolError(content: string | undefined): string {
  return String(content ?? '').replace(/\s+/g, ' ').trim();
}
