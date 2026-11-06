import {describe, expect, it} from 'vitest';
import {resolveTheme} from './theme';

describe('theme selection', () => {
  it('uses an explicit saved theme', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('falls back to the system preference', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(undefined, false)).toBe('light');
  });
});
