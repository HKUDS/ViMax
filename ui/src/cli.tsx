import React, {useEffect, useMemo, useRef, useState} from 'react';
import {render, Box, Text, useApp, useInput, useStdout} from 'ink';
import stringWidth from 'string-width';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {applyStreamEvent, createMappingState} from './lineMapping.js';
import {matchingSlashCommands, shouldShowSlashCommands} from './slashCommands.js';
import {compactionLabel, compactTargetFromEnv, resolveWorkspacePath, type WorkspaceMeta} from './workspaceMeta.js';
import type {MappingState, StreamEvent, WorkspaceLine} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const THINKING_FRAMES = ['', '.', '..', '...'];

const WORKSPACE_BORDER_COLORS = ['blue', 'blueBright', 'cyan', 'blueBright', 'blue'];

type CliOptions = {
  agentArgs: string[];
};

const cliOptions = parseCliArgs(process.argv.slice(2));

function parseCliArgs(argv: string[]): CliOptions {
  const agentArgs: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--new-session') {
      agentArgs.push('--new-session');
      continue;
    }
    if (arg === '--session') {
      const sessionId = argv[index + 1];
      if (!sessionId) throw new Error('--session requires a session id');
      agentArgs.push('--session', sessionId);
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelpAndExit();
    }
    throw new Error(`Unknown TUI argument: ${arg}`);
  }
  return {agentArgs};
}

function printHelpAndExit(): never {
  console.log(`Usage:
  ./vimax tui
  ./vimax tui new
  ./vimax tui resume [session_id]

Direct TUI args:
  --new-session        create and activate a new empty session
  --session <id>       activate an existing session`);
  process.exit(0);
}

function gradientColor(index: number, total: number): string {
  if (total <= 1) return WORKSPACE_BORDER_COLORS[0] ?? 'blue';
  const scaled = (index / (total - 1)) * (WORKSPACE_BORDER_COLORS.length - 1);
  return WORKSPACE_BORDER_COLORS[Math.min(WORKSPACE_BORDER_COLORS.length - 1, Math.max(0, Math.round(scaled)))] ?? 'blue';
}

function useThinkingFrame(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) {
      setFrame(0);
      return;
    }
    const timer = setInterval(() => setFrame((value) => (value + 1) % THINKING_FRAMES.length), 220);
    return () => clearInterval(timer);
  }, [active]);
  return THINKING_FRAMES[frame];
}

function useTerminalWidth(stdout: NodeJS.WriteStream): number {
  const [terminal, setTerminal] = useState({width: Math.max(20, stdout.columns || 100), revision: 0});
  useEffect(() => {
    let resizeTimer: NodeJS.Timeout | null = null;
    const redraw = (clear: boolean) => {
      if (clear) {
        // Ink does not always erase cells from the previous frame when the
        // terminal is resized quickly. Clear only after resize, then force a
        // render even when the new width equals the previous width.
        stdout.write('\u001b[2J\u001b[3J\u001b[H');
      }
      setTerminal((current) => ({width: Math.max(20, stdout.columns || 100), revision: current.revision + 1}));
    };
    const update = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => redraw(true), 60);
    };
    redraw(false);
    stdout.on('resize', update);
    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      stdout.off('resize', update);
    };
  }, [stdout]);
  return terminal.width;
}


function baseAgentArgs(): string[] {
  return ['main_agent.py', '--jsonl', '--stdin-repl', ...cliOptions.agentArgs];
}

function agentCommand(): {command: string; args: string[]} {
  if (process.env.VIMAX_AGENT_COMMAND) {
    return {command: process.env.VIMAX_AGENT_COMMAND, args: splitArgs(process.env.VIMAX_AGENT_ARGS ?? '')};
  }
  if (process.env.VIMAX_PYTHON_CMD) {
    return {command: process.env.VIMAX_PYTHON_CMD, args: baseAgentArgs()};
  }
  if (process.env.VIMAX_UV_CMD) {
    return {command: process.env.VIMAX_UV_CMD, args: ['run', 'python', ...baseAgentArgs()]};
  }
  const venvPython = path.join(repoRoot, '.venv', 'bin', 'python3');
  if (existsSync(venvPython)) {
    return {command: venvPython, args: baseAgentArgs()};
  }
  return {command: 'uv', args: ['run', 'python', ...baseAgentArgs()]};
}


function splitArgs(value: string): string[] {
  return value.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}

function App() {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const terminalWidth = useTerminalWidth(stdout);
  const [lines, setLines] = useState<WorkspaceLine[]>([]);
  const [input, setInput] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef('');
  const cursorRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [activityText, setActivityText] = useState('ViMax thinking');
  const [workspaceMeta, setWorkspaceMeta] = useState<WorkspaceMeta>({
    workspacePath: '.working_dir',
    sessionId: '',
    stage: '',
    compactionUsed: 0,
    compactionTarget: compactTargetFromEnv(process.env),
  });
  const stateRef = useRef<MappingState>(createMappingState());
  const childRef = useRef<ChildProcessWithoutNullStreams | null>(null);
  const bufferRef = useRef('');
  const responseIdleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const width = useMemo(() => Math.max(20, terminalWidth - 6), [terminalWidth]);
  const thinkingFrame = useThinkingFrame(busy);
  const slashMatches = useMemo(() => matchingSlashCommands(input), [input]);
  const showSlashPopup = shouldShowSlashCommands(input, busy);

  useEffect(() => {
    inputRef.current = input;
    const length = Array.from(input).length;
    if (cursorRef.current > length) {
      cursorRef.current = length;
      setCursor(length);
    }
  }, [input]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  function updateInput(next: string, nextCursor: number) {
    const length = Array.from(next).length;
    const boundedCursor = Math.max(0, Math.min(nextCursor, length));
    inputRef.current = next;
    cursorRef.current = boundedCursor;
    setInput(next);
    setCursor(boundedCursor);
  }

  useInput((value, key) => {
    if (key.ctrl && value === 'c') {
      childRef.current?.kill();
      exit();
      return;
    }
    if (busy) return;
    const currentChars = Array.from(inputRef.current);
    const currentCursor = Math.max(0, Math.min(cursorRef.current, currentChars.length));
    if (key.leftArrow) {
      updateInput(inputRef.current, currentCursor - 1);
      return;
    }
    if (key.rightArrow) {
      updateInput(inputRef.current, currentCursor + 1);
      return;
    }
    if ((key as {home?: boolean}).home) {
      updateInput(inputRef.current, 0);
      return;
    }
    if ((key as {end?: boolean}).end) {
      updateInput(inputRef.current, currentChars.length);
      return;
    }
    if (value.includes('\r') || value.includes('\n')) {
      const [beforeBreak] = value.split(/[\r\n]/, 1);
      const pasted = Array.from(beforeBreak ?? '');
      const next = [...currentChars.slice(0, currentCursor), ...pasted, ...currentChars.slice(currentCursor)].join('');
      submit(next);
      return;
    }
    if (key.return) {
      submit(inputRef.current);
      return;
    }
    const isBackspace = key.backspace || value === '\u007f' || value === '\b' || value === '\u001b\u007f';
    const isDelete = key.delete || value === '\u001b[3~' || value === '\u001b[P';
    if (isBackspace) {
      if (currentCursor === 0) return;
      const next = [...currentChars.slice(0, currentCursor - 1), ...currentChars.slice(currentCursor)].join('');
      updateInput(next, currentCursor - 1);
      return;
    }
    if (isDelete) {
      if (currentCursor < currentChars.length) {
        const next = [...currentChars.slice(0, currentCursor), ...currentChars.slice(currentCursor + 1)].join('');
        updateInput(next, currentCursor);
        return;
      }
      if (currentCursor > 0) {
        const next = [...currentChars.slice(0, currentCursor - 1), ...currentChars.slice(currentCursor)].join('');
        updateInput(next, currentCursor - 1);
      }
      return;
    }
    if (!key.ctrl && !key.meta && value) {
      const inserted = Array.from(value);
      const next = [...currentChars.slice(0, currentCursor), ...inserted, ...currentChars.slice(currentCursor)].join('');
      updateInput(next, currentCursor + inserted.length);
    }
  });

  useEffect(() => {
    const {command, args} = agentCommand();
    const child = spawn(command, args, {cwd: repoRoot, env: process.env});
    childRef.current = child;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      bufferRef.current += chunk;
      const parts = bufferRef.current.split('\n');
      bufferRef.current = parts.pop() ?? '';
      for (const part of parts) {
        consumeJsonLine(part);
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      for (const line of chunk.split('\n')) {
        if (!line.trim()) continue;
        appendLine({kind: 'terminal', text: `[stderr]: ${line}`});
      }
    });

    child.on('error', (error) => {
      appendLine({kind: 'error', text: `agent process error: ${error.message}`});
    });

    child.on('exit', (code, signal) => {
      childRef.current = null;
      setBusy(false);
      if (code && code !== 0) {
        appendLine({kind: 'error', text: `agent process exited with code ${code}`});
      } else if (signal) {
        appendLine({kind: 'status', text: `agent process stopped by ${signal}`});
      }
    });

    return () => {
      if (responseIdleTimerRef.current) clearTimeout(responseIdleTimerRef.current);
      child.kill();
    };
  }, []);

  function appendLine(line: WorkspaceLine) {
    stateRef.current = createMappingState();
    setLines((current) => [...current, line]);
  }

  function stripThinking(lines: WorkspaceLine[]): WorkspaceLine[] {
    return lines.filter((line) => line.kind !== 'thinking');
  }

  function consumeJsonLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(trimmed) as StreamEvent;
    } catch (error) {
      appendLine({kind: 'error', text: `invalid JSONL event: ${trimmed}`});
      return;
    }
    updateWorkspaceMeta(event);
    updateActivity(event);
    if (event.type === 'done' || event.type === 'error' || event.type === 'session') {
      clearResponseIdleTimer();
      setBusy(false);
    }
    setLines((current) => {
      const mapped = applyStreamEvent(stripThinking(current), stateRef.current, event);
      stateRef.current = mapped.state;
      return mapped.lines;
    });
  }

  function clearResponseIdleTimer() {
    if (!responseIdleTimerRef.current) return;
    clearTimeout(responseIdleTimerRef.current);
    responseIdleTimerRef.current = null;
  }

  function scheduleResponseIdleClear() {
    clearResponseIdleTimer();
    responseIdleTimerRef.current = setTimeout(() => {
      responseIdleTimerRef.current = null;
      setBusy(false);
    }, 1500);
  }

  function updateActivity(event: StreamEvent) {
    if (event.type === 'tool_start') {
      clearResponseIdleTimer();
      setActivityText(`tool ${event.tool?.name ?? 'unknown'} running`);
      return;
    }
    if (event.type === 'tool_progress') {
      clearResponseIdleTimer();
      const stage = event.progress?.stage;
      setActivityText(stage ? `tool ${event.tool?.name ?? 'unknown'}: ${stage}` : `tool ${event.tool?.name ?? 'unknown'} running`);
      return;
    }
    if (event.type === 'tool_result') {
      clearResponseIdleTimer();
      setActivityText('ViMax thinking');
      return;
    }
    if (event.type === 'token') {
      setActivityText('ViMax responding');
      scheduleResponseIdleClear();
      return;
    }
    if (event.type === 'status') {
      clearResponseIdleTimer();
      setActivityText(statusActivityLabel(event.phase, event.message));
      return;
    }
    if (event.type === 'done' || event.type === 'error' || event.type === 'session') {
      clearResponseIdleTimer();
      setActivityText('ViMax thinking');
      return;
    }
    if (event.type === 'turn') {
      clearResponseIdleTimer();
      setActivityText('ViMax thinking');
    }
  }

  function updateWorkspaceMeta(event: StreamEvent) {
    if (event.type === 'prompt_trace') {
      const used = event.prompt_trace?.totals?.total_tokens ?? event.prompt_trace?.totals?.total_estimated_tokens ?? event.prompt_trace?.total_estimated_tokens;
      if (typeof used === 'number' && Number.isFinite(used)) {
        setWorkspaceMeta((current) => {
          const nextUsed = Math.max(0, Math.round(used));
          const currentPercent = current.compactionTarget > 0 ? Math.round((current.compactionUsed / current.compactionTarget) * 100) : 0;
          const nextPercent = current.compactionTarget > 0 ? Math.round((nextUsed / current.compactionTarget) * 100) : 0;
          if (currentPercent === nextPercent && Math.abs(nextUsed - current.compactionUsed) < 100) return current;
          return {...current, compactionUsed: nextUsed};
        });
      }
      return;
    }
    if (event.type === 'session') {
      const session = event.session?.session;
      if (!session) return;
      setWorkspaceMeta((current) => ({
        ...current,
        workspacePath: resolveWorkspacePath(repoRoot, session.working_dir),
        sessionId: session.session_id ?? current.sessionId,
        stage: session.stage ?? current.stage,
      }));
    }
  }

  function submit(value: string) {
    const prompt = value.trim();
    if (!prompt || busy) return;
    const child = childRef.current;
    if (!child || child.killed || !child.stdin.writable) {
      appendLine({kind: 'error', text: 'agent process is not available'});
      return;
    }
    setLines((current) => [...stripThinking(current), {kind: 'user', text: prompt}]);
    clearResponseIdleTimer();
    setActivityText('ViMax thinking');
    stateRef.current = createMappingState();
    updateInput('', 0);
    setBusy(true);
    child.stdin.write(`${prompt}\n`);
  }

  return (
    <Box flexDirection="column" paddingX={1} width={Math.max(20, terminalWidth - 4)}>
      <WorkspacePanel lines={lines} width={width} thinkingFrame={thinkingFrame} meta={workspaceMeta} busy={busy} activityText={activityText} />
      {showSlashPopup && <SlashCommandPopup matches={slashMatches} width={width} />}
      <Box borderStyle="round" borderColor="white" paddingX={1} marginTop={1} width={width}>
        <Text color={busy ? 'gray' : 'white'}>{busy ? '· ' : '› '}</Text>
        <InputText value={input} cursor={cursor} busy={busy} />
      </Box>
    </Box>
  );
}


function InputText({value, cursor, busy}: {value: string; cursor: number; busy: boolean}) {
  const chars = Array.from(value);
  const boundedCursor = Math.max(0, Math.min(cursor, chars.length));
  const before = chars.slice(0, boundedCursor).join('');
  const current = chars[boundedCursor] ?? ' ';
  const after = chars.slice(boundedCursor + 1).join('');
  if (busy) {
    return <Text color="gray">{value}</Text>;
  }
  return (
    <Text>
      <Text color="white">{before}</Text>
      <Text color="black" backgroundColor="white">{current}</Text>
      <Text color="white">{after}</Text>
    </Text>
  );
}

function SlashCommandPopup({matches, width}: {matches: ReturnType<typeof matchingSlashCommands>; width: number}) {
  const panelWidth = Math.max(20, width);
  const visibleMatches = matches.slice(0, 6);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blueBright" paddingX={1} marginTop={1} width={panelWidth}>
      {visibleMatches.length > 0 ? (
        visibleMatches.map((command) => (
          <Text key={command.name}>
            <Text color="cyanBright">{command.matchedPrefix}</Text>
            <Text color="blueBright">{command.unmatchedSuffix}</Text>
            <Text color="gray">  {command.description}</Text>
          </Text>
        ))
      ) : (
        <Text color="gray">No matching slash commands</Text>
      )}
    </Box>
  );
}

function WorkspacePanel({lines, width, thinkingFrame, meta, busy, activityText}: {lines: WorkspaceLine[]; width: number; thinkingFrame: string; meta: WorkspaceMeta; busy: boolean; activityText: string}) {
  const panelWidth = Math.max(20, width);
  const contentWidth = Math.max(1, panelWidth - 4);
  return (
    <Box flexDirection="column" width={panelWidth}>
      <GradientBorderLine left="╭" fill="─" right="╮" width={panelWidth} />
      <WorkspaceContentLine text="ViMax Workspace" color="blueBright" width={panelWidth} />
      {workspaceHeaderLines(meta, contentWidth).map((line, index) => (
        <WorkspaceContentLine key={`header-${index}`} text={line.text} color={line.color} width={panelWidth} />
      ))}
      {lines.flatMap((line, index) => {
        const rawText = `› ${line.text}`;
        return wrapText(rawText, contentWidth).map((part, partIndex) => (
          <WorkspaceContentLine key={`${line.kind}-${index}-${partIndex}`} text={part} color={lineColor(line)} width={panelWidth} />
        ));
      })}
      {busy && wrapText(`› ${activityText}${thinkingFrame}`, contentWidth).map((part, index) => (
        <WorkspaceContentLine key={`activity-${index}`} text={part} color="cyanBright" width={panelWidth} />
      ))}
      <GradientBorderLine left="╰" fill="─" right="╯" width={panelWidth} />
    </Box>
  );
}

function workspaceHeaderLines(meta: WorkspaceMeta, width: number): Array<{text: string; color: string}> {
  const rows: Array<{text: string; color: string}> = [];
  for (const part of wrapText(`Path: ${meta.workspacePath}`, width)) {
    rows.push({text: part, color: 'gray'});
  }
  const session = [meta.sessionId, displayStage(meta.stage)].filter(Boolean).join(' · ');
  if (session) {
    for (const part of wrapText(`Session: ${session}`, width)) {
      rows.push({text: part, color: 'gray'});
    }
  }
  for (const part of wrapText(compactionLabel(meta.compactionUsed, meta.compactionTarget), width)) {
    rows.push({text: part, color: 'cyanBright'});
  }
  return rows;
}

function statusActivityLabel(phase: string | undefined, message: string | undefined): string {
  if (phase === 'compact') return 'compacting context';
  if (phase === 'sampling_assistant') return 'ViMax thinking';
  if (phase === 'executing_tools') return 'running tools';
  const normalized = String(message ?? '').trim();
  return normalized || 'ViMax thinking';
}

function displayStage(stage: string): string {
  const labels: Record<string, string> = {
    created: 'Created',
    narrative_planning: 'Planning text',
    narrative_planned: 'Text planned',
    novel_planning: 'Planning novel',
    novel_planned: 'Novel planned',
    rendering: 'Rendering',
    rendered: 'Rendered',
    error: 'Error',
  };
  return labels[stage] ?? stage.replace(/_/g, ' ');
}

function GradientBorderLine({left, fill, right, width}: {left: string; fill: string; right: string; width: number}) {
  const fillWidth = Math.max(0, width - 2);
  return (
    <Text>
      <Text color={gradientColor(0, width)}>{left}</Text>
      {Array.from({length: fillWidth}, (_, index) => (
        <Text key={index} color={gradientColor(index + 1, width)}>{fill}</Text>
      ))}
      <Text color={gradientColor(width - 1, width)}>{right}</Text>
    </Text>
  );
}

function WorkspaceContentLine({text, color, width}: {text: string; color: string; width: number}) {
  const contentWidth = Math.max(1, width - 4);
  const padding = Math.max(0, contentWidth - stringWidth(text));
  return (
    <Text>
      <Text color={WORKSPACE_BORDER_COLORS[0]}>│</Text>
      <Text> </Text>
      <Text color={color}>{text}</Text>
      <Text>{' '.repeat(padding)}</Text>
      <Text> </Text>
      <Text color={WORKSPACE_BORDER_COLORS[WORKSPACE_BORDER_COLORS.length - 1]}>│</Text>
    </Text>
  );
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const rows: string[] = [];
  for (const segment of text.split(/\r?\n/)) {
    let current = '';
    let currentWidth = 0;
    for (const char of Array.from(segment)) {
      const charWidth = stringWidth(char);
      if (current && currentWidth + charWidth > width) {
        rows.push(current);
        current = char;
        currentWidth = charWidth;
      } else {
        current += char;
        currentWidth += charWidth;
      }
    }
    rows.push(current);
  }
  return rows;
}

function lineColor(line: WorkspaceLine): string {
  if (line.kind === 'user') return 'yellow';
  if (line.kind === 'assistant') return 'white';
  if (line.kind === 'thinking') return 'cyanBright';
  if (line.kind === 'terminal') return 'cyan';
  if (line.kind === 'error') return 'red';
  if (line.kind === 'tool' && line.status === 'error') return 'red';
  if (line.kind === 'tool') return 'magenta';
  return 'gray';
}

function clearTerminalForTuiStart() {
  if (process.env.VIMAX_TUI_NO_CLEAR === '1') return;
  if (!process.stdout.isTTY) return;
  process.stdout.write('\u001b[2J\u001b[3J\u001b[H');
}

clearTerminalForTuiStart();
render(<App />);
