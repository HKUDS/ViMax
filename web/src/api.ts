import type {AgentConfig, AgentEvent, Artifact, JsonValue, Message, SessionSummary, WorkspaceUpload} from './types';

export async function getSessions() {
  return request<{activeSessionId: string; sessions: SessionSummary[]}>('/api/sessions');
}

export async function deleteSession(sessionId: string) {
  return request<{activeSessionId: string; sessions: SessionSummary[]}>(`/api/sessions?session=${encodeURIComponent(sessionId)}`, {method: 'DELETE'});
}

export async function getAgentConfig() {
  return request<AgentConfig>('/api/config');
}

export async function saveAgentConfig(config: AgentConfig) {
  return request<AgentConfig>('/api/config', {method: 'PUT', body: JSON.stringify(config)});
}

export async function getHistory(sessionId: string) {
  return request<{messages: Message[]}>(`/api/history?session=${encodeURIComponent(sessionId)}`);
}

export async function getArtifacts(sessionId: string) {
  return request<{artifacts: Artifact[]}>(`/api/artifacts?session=${encodeURIComponent(sessionId)}`);
}

export async function uploadWorkspaceFile(sessionId: string, file: File) {
  const url = `/api/uploads?session=${encodeURIComponent(sessionId)}&name=${encodeURIComponent(file.name)}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': file.type || 'application/octet-stream'},
    body: file,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Upload failed with HTTP ${response.status}`);
  return payload as {file: WorkspaceUpload};
}

export async function getJsonArtifact(artifact: Artifact): Promise<JsonValue> {
  const separator = artifact.url.includes('?') ? '&' : '?';
  const response = await fetch(`${artifact.url}${separator}updated=${encodeURIComponent(artifact.updatedAt)}`, {
    cache: 'no-store',
    headers: {Accept: 'application/json'},
  });
  const payload = await response.json();
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload ? String(payload.error) : `Request failed with HTTP ${response.status}`;
    throw new Error(message);
  }
  return payload as JsonValue;
}

export async function startAgent(options: {sessionId?: string; newSession?: boolean; projectName?: string}) {
  return request<{ok: boolean}>('/api/agent/start', {method: 'POST', body: JSON.stringify(options)});
}

export async function sendMessage(text: string) {
  return request<{ok: boolean}>('/api/messages', {method: 'POST', body: JSON.stringify({text})});
}

export async function stopAgent() {
  return request<{ok: boolean}>('/api/agent/stop', {method: 'POST', body: '{}'});
}

export function subscribeToEvents(onEvent: (event: AgentEvent) => void, onConnection: (connected: boolean) => void) {
  const source = new EventSource('/api/events');
  source.onopen = () => onConnection(true);
  source.onerror = () => onConnection(false);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as AgentEvent);
    } catch {
      onEvent({type: 'error', message: 'Received an invalid event from the local bridge'});
    }
  };
  return () => source.close();
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {'Content-Type': 'application/json', ...(init.headers || {})},
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  return payload as T;
}
