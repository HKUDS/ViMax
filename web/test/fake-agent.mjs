import readline from 'node:readline';

const input = readline.createInterface({input: process.stdin});

input.on('line', async (line) => {
  const prompt = line.trim();
  if (!prompt) return;
  const turnId = `turn-${Date.now()}`;
  emit({type: 'turn', turn_id: turnId});
  emit({type: 'prompt_trace', turn_id: turnId, prompt_trace: {totals: {total_tokens: 6840}}});
  emit({type: 'status', turn_id: turnId, phase: 'sampling_assistant', message: 'Sampling assistant'});
  await wait(120);
  emit({type: 'tool_start', turn_id: turnId, tool: {id: 'tool-demo', name: 'vimax_narrative_planning'}});
  await wait(120);
  emit({type: 'tool_progress', turn_id: turnId, tool: {name: 'vimax_narrative_planning'}, progress: {stage: 'design_storyboard', message: 'Designing storyboard'}});
  await wait(220);
  emit({type: 'tool_result', turn_id: turnId, tool_result: {name: 'vimax_narrative_planning', ok: true, content: 'Narrative planning complete'}});
  await wait(100);
  const assistant = `The text plan is ready for **${prompt}**.\n\nI created the script, storyboard, shot decomposition, and camera plan. Would you like to revise the plan or continue to render?`;
  emit({type: 'token', turn_id: turnId, delta: assistant});
  emit({type: 'done', turn_id: turnId, assistant, tool_results: []});
  emit({
    type: 'session',
    turn_id: turnId,
    session: {
      active_session_id: 'demo-session',
      session: {session_id: 'demo-session', working_dir: '.working_dir/demo-session', stage: 'narrative_planned'},
    },
  });
});

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
