import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { buildSplash, modeSelectRows, modeSelectedRow, nextModeIndex, type SplashInfo } from '../src/index.js';
import { plainPalette } from '../src/palette.js';

function base(): SplashInfo {
  return {
    rootDir: 'D:/work/demo',
    sessionsRoot: 'C:/Users/me/.nova/sessions',
    home: 'C:/Users/me',
    version: '0.2.0',
    skills: [],
    warnings: [],
    cols: 100,
  };
}

/** Panel rows = from the top border through the bottom border. */
function panel(lines: string[]): string[] {
  const top = lines.findIndex((l) => l.trimStart().startsWith('╭'));
  const bottom = lines.findIndex((l) => l.trimStart().startsWith('╰'));
  return lines.slice(top, bottom + 1);
}

describe('buildSplash', () => {
  it('renders the version in the brand line', () => {
    const lines = buildSplash(plainPalette, base());
    expect(lines.find((l) => l.includes('Nova'))).toContain('v0.2.0');
  });

  it('renders an empty version as bare v prefix only', () => {
    const lines = buildSplash(plainPalette, { ...base(), version: '' });
    const brand = lines.find((l) => l.includes('Nova'));
    // No "undefined"/"null" leakage when the caller forgets the field.
    expect(brand).toBeDefined();
    expect(brand).not.toContain('undefined');
    expect(brand).not.toContain('null');
  });

  it('drops the ASCII logotype — the panel is the whole hero', () => {
    const lines = buildSplash(plainPalette, base());
    expect(lines.some((l) => l.includes('| |/ /'))).toBe(false);
    expect(lines[0]!.trimStart().startsWith('╭')).toBe(true);
  });

  it('carries the destination only: no model/approval/mode echo of the status bar', () => {
    const lines = buildSplash(plainPalette, base());
    expect(lines.some((l) => l.includes('D:/work/demo'))).toBe(true);
    expect(lines.some((l) => l.includes('.nova/sessions'))).toBe(true);
    expect(lines.some((l) => l.includes('模型'))).toBe(false);
    expect(lines.some((l) => l.includes('审批'))).toBe(false);
    expect(lines.some((l) => l.includes('模式'))).toBe(false);
    // The key hints moved to the composer placeholder, not a panel row.
    expect(lines.some((l) => l.includes('Ctrl+C'))).toBe(false);
  });

  it('abbreviates the home prefix so the informative tail survives clipping', () => {
    const lines = buildSplash(plainPalette, { ...base(), cols: 60 });
    expect(lines.some((l) => l.includes('~/.nova/sessions'))).toBe(true);
    expect(lines.some((l) => l.includes('C:/Users/me'))).toBe(false);
    // 家目录之外的绝对路径原样显示（不误伤）。
    const other = buildSplash(plainPalette, { ...base(), rootDir: '/srv/app', cols: 60 });
    expect(other.some((l) => l.includes('/srv/app'))).toBe(true);
  });

  it('centers the panel and keeps every border row the same width', () => {
    for (const cols of [40, 60, 80, 100, 140]) {
      const lines = panel(buildSplash(plainPalette, { ...base(), cols }));
      const width = styledWidth(lines[0]!);
      for (const row of lines) expect(styledWidth(row)).toBe(width);
      expect(width).toBeLessThanOrEqual(cols);
      // Centered, not pinned to the left gutter, once there is room to spare.
      if (cols >= 60) expect(lines[0]!.startsWith('  ')).toBe(true);
    }
  });

  it('clips long paths but keeps the version intact', () => {
    const lines = buildSplash(plainPalette, { ...base(), cols: 24 });
    expect(lines[0]).toContain('v0.2.0');
    expect(lines[0]).toContain('Nova');
    for (const line of buildSplash(plainPalette, { ...base(), cols: 24 })) {
      expect(styledWidth(line)).toBeLessThanOrEqual(24);
    }
  });

  it('renders the trust-posture hint as a dim row right below the panel', () => {
    const lines = buildSplash(plainPalette, base());
    const borderIdx = lines.findIndex((l) => l.trimStart().startsWith('╰'));
    expect(borderIdx).toBeGreaterThan(0);
    const hint = lines[borderIdx + 1]!;
    expect(hint).toContain('bash / run_code');
    // Doc-aligned honesty: no claim of sandboxing or system-level isolation.
    expect(hint).toContain('无沙箱');
    expect(hint).not.toContain('沙箱级');
    // 精简后的揭示仍在一行内，不再占整段"说教"。
    expect(styledWidth(hint)).toBeLessThan(60);
  });

  it('shows the hint even when skills/warnings are absent', () => {
    expect(buildSplash(plainPalette, base()).some((l) => l.includes('bash / run_code'))).toBe(true);
  });

  it('lists skills and warnings as plain rows below the panel', () => {
    const lines = buildSplash(plainPalette, { ...base(), skills: ['pdf', 'git-flow'], warnings: ['技能目录不可读'] });
    const skills = lines.find((l) => l.includes('技能'));
    expect(skills).toContain('pdf');
    expect(skills).toContain('git-flow');
    expect(lines.at(-1)).toContain('技能目录不可读');
    // 面板本身不因长清单而变宽（技能在框外）。
    expect(panel(lines)).toHaveLength(4);
  });

  it('clamps every row to the cols budget on narrow screens', () => {
    for (const cols of [40, 60, 80, 100, 140]) {
      const lines = buildSplash(plainPalette, {
        ...base(),
        cols,
        skills: Array.from({ length: 12 }, (_, i) => `skill-${i}`),
        warnings: ['warn'.repeat(40)],
      });
      for (const line of lines) expect(styledWidth(line), `cols=${cols}`).toBeLessThanOrEqual(cols);
    }
  });
});

describe('startup mode selector (modeSelectRows, 单行分段控件)', () => {
  it('renders one row with the highlighted option as its own capsule', () => {
    const rows = modeSelectRows(plainPalette, { index: 1, ptcAvailable: true, cols: 100 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('[ PTC ]');
    expect(rows[0]).toContain('[普通]');
    expect(rows[0]).toContain('[混合]');
    expect(rows[0]).toContain('Enter 确认');
  });

  it('annotates the runtime floor only when an unavailable option is highlighted', () => {
    expect(modeSelectRows(plainPalette, { index: 1, ptcAvailable: false, cols: 100 })[0]).toContain('需 Node ≥ 22.19');
    expect(modeSelectRows(plainPalette, { index: 0, ptcAvailable: false, cols: 100 })[0]).not.toContain('22.19');
  });

  it('degrades by dropping whole fields, never mid-word', () => {
    const wide = modeSelectRows(plainPalette, { index: 0, ptcAvailable: true, cols: 100 })[0]!;
    expect(wide).toContain('内置工具直调');
    const tight = modeSelectRows(plainPalette, { index: 1, ptcAvailable: true, cols: 56 })[0]!;
    expect(tight).not.toContain('编排'); // 先丢说明性文字
    expect(tight).toContain('Enter 确认'); // 按键提示留到最后
    expect(styledWidth(tight)).toBeLessThanOrEqual(54);
  });

  it('rows stay within the terminal budget on narrow screens', () => {
    for (const cols of [40, 60, 80]) {
      for (const row of modeSelectRows(plainPalette, { index: 0, ptcAvailable: true, cols })) {
        expect(styledWidth(row)).toBeLessThanOrEqual(cols);
      }
    }
  });
});

describe('nextModeIndex (skip unavailable segments, wrap at ends)', () => {
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
    expect(row).toContain('[PTC]');
    expect(row).toContain('Tab 可随时切换');
  });
});
