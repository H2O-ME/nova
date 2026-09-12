import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
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

  it('renders the trust-posture hint as a dim row right below the panel', () => {
    const lines = buildSplash(plainPalette, base());
    // Panel is lines 0..N-1 (bottom border is `╰…╯`); the hint follows it.
    const borderIdx = lines.findIndex((l) => l.startsWith('╰'));
    expect(borderIdx).toBeGreaterThan(0);
    const hint = lines[borderIdx + 1];
    expect(hint).toContain('bash / run_code 在本机执行任意命令');
    expect(hint).toContain('审批门 + 工作区边界');
    expect(hint).toContain('无沙箱');
    expect(hint).toContain('容器化');
    // Doc-aligned honesty: no claim of sandboxing or system-level isolation.
    expect(hint).not.toContain('沙箱级');
    expect(hint).toContain('无沙箱');
  });

  it('shows the hint even when skills/warnings are absent', () => {
    const lines = buildSplash(plainPalette, base());
    expect(lines.some((l) => l.includes('bash / run_code'))).toBe(true);
  });

  it('clamps the trust hint to the cols budget on narrow screens', () => {
    for (const cols of [40, 60, 80, 100, 140]) {
      const lines = buildSplash(plainPalette, { ...base(), cols });
      const hint = lines.find((l) => l.includes('bash / run_code'));
      expect(hint, `cols=${cols}`).toBeDefined();
      // Clipping (head-preserving with `…`) keeps the row within the
      // terminal width, so it can never blow the layout.
      expect(styledWidth(hint as string)).toBeLessThanOrEqual(cols);
    }
  });
});