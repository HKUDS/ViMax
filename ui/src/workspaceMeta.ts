export type WorkspaceMeta = {
  workspacePath: string;
  sessionId: string;
  stage: string;
  compactionUsed: number;
  compactionTarget: number;
};

export function compactTargetFromEnv(env: Record<string, string | undefined>): number {
  const contextWindow = parsePositiveInt(env.VIMAX_CONTEXT_WINDOW_TOKENS, 200000);
  const ratio = parsePositiveFloat(env.VIMAX_AUTO_COMPACT_RATIO, 0.9);
  const threshold = parsePositiveInt(env.VIMAX_AUTO_COMPACT_TOKEN_THRESHOLD, Math.round(contextWindow * Math.min(1, Math.max(0, ratio))));
  const buffer = parsePositiveInt(env.VIMAX_AUTO_COMPACT_BUFFER_TOKENS, 20000);
  return Math.max(0, threshold - buffer);
}

export function compactionBar(used: number, target: number, width = 18): string {
  const safeWidth = Math.max(4, width);
  if (target <= 0) return '░'.repeat(safeWidth);
  const ratio = Math.min(1, Math.max(0, used / target));
  const filled = Math.round(ratio * safeWidth);
  return '█'.repeat(filled) + '░'.repeat(safeWidth - filled);
}

export function compactionLabel(used: number, target: number): string {
  if (target <= 0) return 'Compaction disabled';
  const safeUsed = Math.max(0, Math.round(used));
  const percent = Math.min(999, Math.max(0, Math.round((safeUsed / target) * 100)));
  return `Compaction [${compactionBar(safeUsed, target)}] ${safeUsed}/${target} (${percent}%)`;
}

export function resolveWorkspacePath(_repoRoot: string, workingDir?: string): string {
  const normalized = String(workingDir ?? '').trim();
  if (!normalized) return '.working_dir';
  const relative = normalized.replace(/^.*\/\.working_dir\//, '.working_dir/').replace(/^\.\//, '');
  if (relative.startsWith('.working_dir/')) return relative;
  if (relative === '.working_dir') return relative;
  return `.working_dir/${relative.replace(/^\/+/, '')}`;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}
