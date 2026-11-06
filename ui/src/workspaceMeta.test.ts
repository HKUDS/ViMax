import assert from 'node:assert/strict';
import {compactionBar, compactionLabel, compactTargetFromEnv, resolveWorkspacePath} from './workspaceMeta.js';

assert.equal(compactTargetFromEnv({}), 160000);
assert.equal(compactTargetFromEnv({VIMAX_AUTO_COMPACT_TOKEN_THRESHOLD: '100', VIMAX_AUTO_COMPACT_BUFFER_TOKENS: '30'}), 70);
assert.equal(compactTargetFromEnv({VIMAX_CONTEXT_WINDOW_TOKENS: '400000', VIMAX_AUTO_COMPACT_RATIO: '0.9', VIMAX_AUTO_COMPACT_BUFFER_TOKENS: '30000'}), 330000);
assert.equal(compactionBar(0, 100, 4), '░░░░');
assert.equal(compactionBar(50, 100, 4), '██░░');
assert.equal(compactionBar(200, 100, 4), '████');
assert.equal(compactionLabel(50, 100), 'Compaction [█████████░░░░░░░░░] 50/100 (50%)');
assert.equal(resolveWorkspacePath('/repo', '.working_dir/s1'), '.working_dir/s1');
assert.equal(resolveWorkspacePath('/repo', '/repo/.working_dir/s1'), '.working_dir/s1');
assert.equal(resolveWorkspacePath('/repo'), '.working_dir');
assert.equal(resolveWorkspacePath('/repo', '20260608-vimax'), '.working_dir/20260608-vimax');

console.log('workspaceMeta tests passed');
