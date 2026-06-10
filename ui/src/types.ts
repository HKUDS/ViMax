export type WorkspaceLine =
  | {kind: 'user'; text: string}
  | {kind: 'assistant'; text: string}
  | {kind: 'thinking'; text: string}
  | {kind: 'status'; text: string}
  | {kind: 'workflow'; text: string}
  | {kind: 'tool'; text: string; status?: 'running' | 'done' | 'error'}
  | {kind: 'terminal'; text: string}
  | {kind: 'session'; text: string}
  | {kind: 'error'; text: string};

export type ToolResult = {
  name?: string;
  ok?: boolean;
  content?: string;
  metadata?: Record<string, unknown>;
};

export type StreamEvent = {
  type?: string;
  turn_id?: string;
  delta?: string;
  phase?: string;
  message?: string;
  stream?: string;
  line?: string;
  assistant?: string;
  tool?: {name?: string; requested_name?: string; arguments?: Record<string, unknown>};
  progress?: {stage?: string; message?: string; metadata?: Record<string, unknown>};
  tool_result?: ToolResult;
  session?: {
    active_session_id?: string;
    session?: {
      session_id?: string;
      stage?: string;
      working_dir?: string;
    } | null;
  };
  prompt_trace?: {
    total_estimated_tokens?: number;
    totals?: {
      total_tokens?: number;
      total_estimated_tokens?: number;
    };
  };
};

export type MappingState = {
  assistantStreaming: boolean;
};
