export type SessionSummary = {
  sessionId: string;
  projectName: string;
  workingDir: string;
  stage: string;
  summary: string;
  idea: string;
  updatedAt: string;
  createdAt: string;
  compactionTurns: number;
};

export type ConfigSection = {
  model_provider?: string;
  model: string;
  base_url: string;
  api_key: string;
  has_api_key: boolean;
};

export type AgentConfig = {
  sections: Record<'llm' | 'image' | 'video' | 'embedding' | 'reranker', ConfigSection>;
};

export type Artifact = {
  path: string;
  name: string;
  kind: 'image' | 'video' | 'document';
  size: number;
  updatedAt: string;
  url: string;
};

export type WorkspaceUpload = {
  name: string;
  path: string;
  size: number;
};

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonValue[] | {[key: string]: JsonValue};

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'activity' | 'error';
  text: string;
  createdAt?: string;
  tool?: string;
  status?: 'running' | 'done' | 'error';
  stage?: string;
};

export type AgentEvent = {
  type?: string;
  turn_id?: string;
  delta?: string;
  message?: string;
  phase?: string;
  status?: string;
  stream?: string;
  line?: string;
  assistant?: string;
  activeSessionId?: string;
  sessions?: SessionSummary[];
  tool?: {id?: string; name?: string; requested_name?: string};
  progress?: {stage?: string; message?: string; metadata?: Record<string, unknown>};
  tool_result?: {name?: string; ok?: boolean; content?: string; metadata?: Record<string, unknown>};
  session?: {
    active_session_id?: string;
    session?: {
      session_id?: string;
      working_dir?: string;
      stage?: string;
      summary?: string;
    } | null;
  };
  prompt_trace?: {
    total_estimated_tokens?: number;
    totals?: {total_tokens?: number; total_estimated_tokens?: number};
  };
};

export type ChatState = {
  messages: Message[];
  busy: boolean;
  turnId: string;
  promptTokens: number;
};
