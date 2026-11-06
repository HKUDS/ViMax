import {describe, expect, it} from 'vitest';
import {matchingSlashCommands, shouldShowSlashCommands} from './slashCommands';

describe('slash command matching', () => {
  it('matches command prefixes and exposes highlighted segments', () => {
    expect(matchingSlashCommands('/co')[0]).toMatchObject({matchedPrefix: '/co', unmatchedSuffix: 'mpact'});
  });

  it('only opens for idle slash input', () => {
    expect(shouldShowSlashCommands('/', false)).toBe(true);
    expect(shouldShowSlashCommands('/co', true)).toBe(false);
    expect(shouldShowSlashCommands('hello', false)).toBe(false);
  });
});
