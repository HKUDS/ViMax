import {mkdtemp, mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {deleteSession, listSessionArtifacts, readSessionHistory, readSessionState, resolveArtifactPath, storeWorkspaceUpload} from './server-lib.mjs';

const roots = [];

afterEach(async () => {
  const {rm} = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vimax-web-'));
  roots.push(root);
  await mkdir(path.join(root, '.vimax', 'logs'), {recursive: true});
  await mkdir(path.join(root, '.working_dir', 'session-1', 'script2video', 'shots', '0'), {recursive: true});
  await writeFile(path.join(root, '.vimax', 'sessions.json'), JSON.stringify({
    active_session_id: 'session-1',
    sessions: {
      'session-1': {session_id: 'session-1', project_name: 'Ocean campaign', working_dir: '.working_dir/session-1', stage: 'rendering', updated_at: '2026-07-17T10:00:00'},
    },
  }));
  return root;
}

describe('web bridge state', () => {
  it('returns sanitized session records', async () => {
    const root = await fixture();
    const state = await readSessionState(root);
    expect(state.activeSessionId).toBe('session-1');
    expect(state.sessions[0]).toMatchObject({sessionId: 'session-1', projectName: 'Ocean campaign', stage: 'rendering'});
  });

  it('restores persisted turn history', async () => {
    const root = await fixture();
    await writeFile(path.join(root, '.vimax', 'logs', 'loop_history.jsonl'), `${JSON.stringify({
      session_id: 'session-1', turn_id: 'turn-1', raw_user_input: 'Make a film', final_assistant_text: 'Planning is ready', status: 'completed', tool_rounds: [],
    })}\n`);
    const history = await readSessionHistory(root, 'session-1');
    expect(history.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('hides workspace upload metadata from restored user messages', async () => {
    const root = await fixture();
    await writeFile(path.join(root, '.vimax', 'logs', 'loop_history.jsonl'), `${JSON.stringify({
      session_id: 'session-1',
      turn_id: 'turn-upload',
      raw_user_input: 'Use this script <workspace_uploads>["uploads/script.txt"]</workspace_uploads>',
    })}\n`);
    const history = await readSessionHistory(root, 'session-1');
    expect(history[0].text).toBe('Use this script');
  });

  it('does not expose successful tool result payloads in restored history', async () => {
    const root = await fixture();
    await writeFile(path.join(root, '.vimax', 'logs', 'loop_history.jsonl'), `${JSON.stringify({
      session_id: 'session-1',
      turn_id: 'turn-tool',
      raw_user_input: 'Plan a video',
      tool_rounds: [{tool_results: [{
        name: 'vimax_narrative_planning',
        ok: true,
        content: JSON.stringify({session_id: 'session-1', working_dir: '.working_dir/session-1', generated: ['script.json']}),
      }]}],
    })}\n`);
    const history = await readSessionHistory(root, 'session-1');
    const activity = history.find((message) => message.role === 'activity');
    expect(activity).toMatchObject({text: 'Completed', status: 'done', stage: 'completed'});
    expect(JSON.stringify(activity)).not.toContain('working_dir');
  });

  it('lists media artifacts and blocks path traversal', async () => {
    const root = await fixture();
    await writeFile(path.join(root, '.working_dir', 'session-1', 'script2video', 'shots', '0', 'first_frame.png'), 'image');
    const artifacts = await listSessionArtifacts(root, 'session-1');
    expect(artifacts[0]).toMatchObject({kind: 'image', name: 'first_frame.png'});
    expect(() => resolveArtifactPath(root, 'session-1', '../../secrets')).toThrow(/escapes/);
  });

  it('stores uploads inside the session without overwriting matching names', async () => {
    const root = await fixture();
    const first = await storeWorkspaceUpload(root, 'session-1', 'script.txt', Buffer.from('first'));
    const second = await storeWorkspaceUpload(root, 'session-1', 'script.txt', Buffer.from('second'));
    expect(first).toMatchObject({name: 'script.txt', path: 'uploads/script.txt', size: 5});
    expect(second).toMatchObject({name: 'script (2).txt', path: 'uploads/script (2).txt', size: 6});
    expect(await readFile(path.join(root, '.working_dir', 'session-1', second.path), 'utf8')).toBe('second');
    await expect(storeWorkspaceUpload(root, 'session-1', '../escape.txt', Buffer.from('no'))).rejects.toThrow(/unsupported/);
  });

  it('deletes project state, artifacts, and matching log records', async () => {
    const root = await fixture();
    const logPath = path.join(root, '.vimax', 'logs', 'loop_history.jsonl');
    await writeFile(logPath, [
      JSON.stringify({session_id: 'session-1', raw_user_input: 'Delete me'}),
      JSON.stringify({session_id: 'session-2', raw_user_input: 'Keep me'}),
      '',
    ].join('\n'));

    const state = await deleteSession(root, 'session-1');
    expect(state).toEqual({activeSessionId: '', sessions: []});
    await expect(stat(path.join(root, '.working_dir', 'session-1'))).rejects.toThrow();
    expect(await readFile(logPath, 'utf8')).toContain('session-2');
    expect(await readFile(logPath, 'utf8')).not.toContain('session-1');
  });
});
