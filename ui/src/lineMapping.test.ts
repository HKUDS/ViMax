import assert from 'node:assert/strict';
import {applyStreamEvent, createMappingState} from './lineMapping.js';
import type {MappingState, WorkspaceLine} from './types.js';

let lines: WorkspaceLine[] = [];
let state: MappingState = createMappingState();

lines = [...lines, {kind: 'user', text: 'start'}];
assert.deepEqual(lines[0], {kind: 'user', text: 'start'});

({lines, state} = applyStreamEvent(lines, state, {type: 'token', delta: 'hello'}));
({lines, state} = applyStreamEvent(lines, state, {type: 'token', delta: ' world'}));
assert.equal(lines.length, 2);
assert.deepEqual(lines[1], {kind: 'assistant', text: 'hello world'});

({lines, state} = applyStreamEvent(lines, state, {type: 'tool_start', tool: {name: 'vimax_narrative_planning'}}));
({lines, state} = applyStreamEvent(lines, state, {type: 'tool_progress', tool: {name: 'vimax_narrative_planning'}, progress: {stage: 'running', message: 'planning'}}));
({lines, state} = applyStreamEvent(lines, state, {type: 'tool_result', tool_result: {name: 'vimax_narrative_planning', ok: true}}));
assert.equal(lines.at(-3)?.kind, 'tool');
assert.equal(lines.at(-2)?.kind, 'tool');
assert.deepEqual(lines.at(-1), {kind: 'tool', status: 'done', text: 'tool vimax_narrative_planning done'});

({lines, state} = applyStreamEvent(lines, state, {type: 'tool_result', tool_result: {name: 'vimax_narrative_planning', ok: false, content: 'Developing story failed: Request timed out.'}}));
assert.deepEqual(lines.at(-1), {kind: 'tool', status: 'error', text: 'tool vimax_narrative_planning error: Developing story failed: Request timed out.'});

({lines, state} = applyStreamEvent(lines, state, {type: 'terminal', stream: 'stdout', line: 'render log'}));
assert.deepEqual(lines.at(-1), {kind: 'terminal', text: '[stdout]: render log'});

const lengthBeforeInternalEvents = lines.length;
({lines, state} = applyStreamEvent(lines, state, {type: 'turn', turn_id: 'turn-1'}));
({lines, state} = applyStreamEvent(lines, state, {type: 'status', phase: 'sampling_assistant', message: 'Sampling assistant'}));
({lines, state} = applyStreamEvent(lines, state, {type: 'session', session: {active_session_id: 's1', session: {session_id: 's1', stage: 'narrative_planned', working_dir: '.working_dir/s1'}}}));
assert.equal(lines.length, lengthBeforeInternalEvents);

({lines, state} = applyStreamEvent(lines, state, {type: 'error', message: 'bad'}));
assert.deepEqual(lines.at(-1), {kind: 'error', text: 'bad'});

({lines, state} = applyStreamEvent(lines, state, {type: 'done', assistant: 'hello world'}));
assert.equal(state.assistantStreaming, false);

console.log('lineMapping tests passed');
