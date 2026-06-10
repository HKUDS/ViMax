import assert from 'node:assert/strict';
import {matchingSlashCommands, shouldShowSlashCommands, slashCommandQuery} from './slashCommands.js';

assert.equal(shouldShowSlashCommands('/', false), true);
assert.equal(shouldShowSlashCommands('/co', false), true);
assert.equal(shouldShowSlashCommands('/co', true), false);
assert.equal(shouldShowSlashCommands('hello', false), false);

assert.equal(slashCommandQuery('/compact now'), '/compact');
assert.equal(slashCommandQuery('/co'), '/co');

assert.deepEqual(matchingSlashCommands('/').map((command) => command.name), ['/compact']);
assert.deepEqual(matchingSlashCommands('/com').map((command) => command.name), ['/compact']);
assert.deepEqual(matchingSlashCommands('/compact').map((command) => command.name), ['/compact']);
assert.deepEqual(matchingSlashCommands('/x').map((command) => command.name), []);

const slashOnly = matchingSlashCommands('/')[0];
assert.equal(slashOnly?.matchedPrefix, '/');
assert.equal(slashOnly?.unmatchedSuffix, 'compact');

const partial = matchingSlashCommands('/co')[0];
assert.equal(partial?.matchedPrefix, '/co');
assert.equal(partial?.unmatchedSuffix, 'mpact');

const full = matchingSlashCommands('/compact')[0];
assert.equal(full?.matchedPrefix, '/compact');
assert.equal(full?.unmatchedSuffix, '');

console.log('slashCommands tests passed');
