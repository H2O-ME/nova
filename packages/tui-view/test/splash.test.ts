import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { buildSplash, modeSelectRows, modeSelectedRow, nextModeIndex, type SplashInfo } from '../src/index.js';
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
    const brand = lines.find((l) => l.includes('Nova'));
    expect(brand).toContain('v0.2.0');
  });

  it('renders an empty version as bare v prefix only', () => {
    const lines = buildSplash(plainPalette, { ...base(), version: '' });
    const brand = lines.find((l) => l.includes('Nova'));
    // No "undefined"/"null" leakage when the caller forgets the field.
    expect(brand).toBeDefined();
    expect(brand).not.toContain('undefined');
    expect(brand).not.toContain('null');
  });

  it('prepends the ASCII logotype on wide screens and skips it on narrow ones', () => {
    const wide = buildSplash(plainPalette, base());
    expect(wide[1]).toContain('| |/ /'); // figlet "Nova" (row 2)
    const narrow = buildSplash(plainPalette, { ...base(), cols: 24 });
    expect(narrow[0]).toContain('Nova'); // brand line is first again
    expect(narrow.some((l) => l.includes('| |/ /'))).toBe(false);
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
    expect(hint).toContain('bash / run_code');
    // Doc-aligned honesty: no claim of sandboxing or system-level isolation.
    expect(hint).toContain('无沙箱');
    expect(hint).not.toContain('沙箱级');
    // 精简后的揭示仍在一行内，不再占整段"说教"。
    expect(styledWidth(hint)).toBeLessThan(60);
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
describe('startup mode selector (modeSelectRows)', () => {
  it('marks the highlighted row with ‣ and bold, others dim', () => {
    const rows = modeSelectRows(plainPalette, { index: 1, ptcAvailable: true, cols: 100 });
    expect(rows).toHaveLength(5); // header + 3 options + hint
    expect(rows[1]).not.toContain('‣');
    expect(rows[2]).toContain('‣ PTC');
    expect(rows[3]).not.toContain('‣');
    expect(rows.at(-1)).toContain('Enter 确认');
  });

  it('dims and annotates PTC rows when the runtime cannot support them', () => {
    const rows = modeSelectRows(plainPalette, { index: 0, ptcAvailable: false, cols: 100 });
    expect(rows[2]).toContain('需要 Node ≥ 22.19');
    expect(rows[3]).toContain('需要 Node ≥ 22.19');
  });

  it('rows stay within the terminal budget on narrow screens', () => {
    for (const cols of [40, 60, 80]) {
      for (const row of modeSelectRows(plainPalette, { index: 0, ptcAvailable: true, cols })) {
        expect(styledWidth(row)).toBeLessThanOrEqual(cols);
      }
    }
  });
});

describe('nextModeIndex (skip unavailable rows, wrap at ends)', () => {
  it('moves plainly when everything is selectable', () => {
    expect(nextModeIndex(0, 1, true)).toBe(1);
    expect(nextModeIndex(2, 1, true)).toBe(0); // wrap
    expect(nextModeIndex(0, -1, true)).toBe(2); // wrap backwards
  });

  it('skips PTC and 混合 when the runtime lacks type stripping', () => {
    expect(nextModeIndex(0, 1, false)).toBe(0); // only 普通 selectable: no move
    expect(nextModeIndex(0, -1, false)).toBe(0);
  });
});

describe('modeSelectedRow (collapsed confirmation)', () => {
  it('names the kept mode with the switch hint', () => {
    const row = modeSelectedRow(plainPalette, 'ptc', 100);
    expect(row).toContain('执行模式');
    expect(row).toContain('PTC');
    expect(row).toContain('Tab 可随时切换');
  });
});
