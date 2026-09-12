import { describe, expect, it } from 'vitest';
import { buildSplash, type SplashInfo } from '../src/index.js';
import { plainPalette } from '../src/palette.js';

function base(): SplashInfo {
  return {
    rootDir: 'D:/work/demo',
    sessionsRoot: 'C:/Users/me/.nova/sessions',
    model: 'deepseek-ultra',
    approval: 'auto-edit',
    codeMode: 'native',
    version: '0.2.0',
    skills: [],
    warnings: [],
    cols: 100,
  };
}

describe('buildSplash', () => {
  it('renders the version in the brand line', () => {
    const lines = buildSplash(plainPalette, base());
    expect(lines[0]).toContain('Nova');
    expect(lines[0]).toContain('v0.2.0');
  });

  it('renders an empty version as bare v prefix only', () => {
    const lines = buildSplash(plainPalette, { ...base(), version: '' });
    expect(lines[0]).toContain('Nova');
    // No "undefined"/"null" leakage when the caller forgets the field.
    expect(lines[0]).not.toContain('undefined');
    expect(lines[0]).not.toContain('null');
  });

  it('clips long paths but keeps the version intact', () => {
    const lines = buildSplash(plainPalette, { ...base(), cols: 24 });
    expect(lines[0]).toContain('v0.2.0');
    expect(lines[0]).toContain('Nova');
  });
});