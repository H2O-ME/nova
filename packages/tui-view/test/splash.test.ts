import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { buildWelcome, nextModeIndex, type WelcomeView } from '../src/index.js';
import { plainPalette } from '../src/palette.js';

function base(over: Partial<WelcomeView> = {}): WelcomeView {
  return {
    rootDir: 'D:/work/demo',
    sessionsRoot: 'C:/Users/me/.nova/sessions',
    home: 'C:/Users/me',
    version: '0.2.0',
    skills: [],
    warnings: [],
    cols: 100,
    codeMode: 'native',
    ...over,
  };
}

/** Rows between the two horizontal borders (the card body). */
function body(lines: string[]): string[] {
  const top = lines.findIndex((l) => l.trimStart().startsWith('╭'));
  const bottom = lines.findIndex((l) => l.trimStart().startsWith('╰'));
  return lines.slice(top + 1, bottom);
}

describe('buildWelcome（单张居中卡片承载开屏）', () => {
  it('品牌与版本在顶边框里', () => {
    const lines = buildWelcome(plainPalette, base());
    expect(lines[0]).toContain('Nova');
    expect(lines[0]).toContain('v0.2.0');
    const empty = buildWelcome(plainPalette, base({ version: '' }));
    expect(empty[0]).toContain('Nova');
    expect(empty.join('\n')).not.toContain('undefined');
  });

  it('卡片只承载去处/技能/模式/信任，不复读状态栏的身份信息', () => {
    const text = buildWelcome(plainPalette, base()).join('\n');
    expect(text).toContain('D:/work/demo');
    expect(text).toContain('模式');
    expect(text).toContain('沙箱');
    expect(text).not.toContain('审批');
    expect(text).not.toContain('Ctrl+C'); // 按键提示归 composer 占位行
  });

  it('家目录前缀折成 ~/，让尾段活过裁剪', () => {
    const text = buildWelcome(plainPalette, base({ cols: 60 })).join('\n');
    expect(text).toContain('~/.nova/sessions');
    expect(text).not.toContain('C:/Users/me');
    expect(buildWelcome(plainPalette, base({ rootDir: '/srv/app', cols: 60 })).join('\n')).toContain('/srv/app');
  });

  it('每一行等宽、整块水平居中、且绝不超出 cols', () => {
    for (const cols of [40, 60, 80, 100, 140]) {
      const lines = buildWelcome(plainPalette, base({ cols }));
      const width = styledWidth(lines[0]!);
      for (const line of lines) expect(styledWidth(line), `cols=${cols}`).toBe(width);
      expect(width).toBeLessThanOrEqual(cols);
      // 居中：左右留白至多差一格。
      const left = lines[0]!.length - lines[0]!.trimStart().length;
      expect(Math.abs(cols - width - left)).toBeLessThanOrEqual(1);
    }
  });

  it('信任姿态如实写进卡片：无沙箱、不宣称隔离', () => {
    const row = body(buildWelcome(plainPalette, base())).find((l) => l.includes('沙箱'))!;
    expect(row).toContain('无');
    expect(row).toContain('bash / run_code');
    expect(row).not.toContain('沙箱级');
  });

  it('技能以计数形式入卡（名字清单留给 /skill）', () => {
    const row = body(buildWelcome(plainPalette, base({ skills: ['a', 'b', 'c'] }))).find((l) => l.includes('技能'))!;
    expect(row).toContain('3 个');
    expect(row).toContain('/skill');
    expect(body(buildWelcome(plainPalette, base())).some((l) => l.includes('技能'))).toBe(false);
  });

  it('告警作为 ⚠ 行并入同一张卡（不再散落框外）', () => {
    const lines = buildWelcome(plainPalette, base({ warnings: ['技能目录不可读'] }));
    expect(body(lines).some((l) => l.includes('⚠ 技能目录不可读'))).toBe(true);
  });

  it('选择器塌缩后模式行只剩当前档与 Tab 提示', () => {
    const row = body(buildWelcome(plainPalette, base({ codeMode: 'ptc' }))).find((l) => l.includes('模式'))!;
    expect(row).toContain('PTC');
    expect(row).toContain('Tab 可随时切换');
    expect(row).not.toContain('↑↓');
  });
});

describe('卡片内的模式分段控件（select 在架）', () => {
  const modeRow = (over: Partial<WelcomeView>) =>
    body(buildWelcome(plainPalette, base(over))).find((l) => l.includes('模式'))!;

  it('光标是反色胶囊，已生效档位带 • 点，待切换时明说「将切到」', () => {
    const row = modeRow({ select: { index: 2, ptcAvailable: true } });
    expect(row).toContain('[ 混合 ]'); // cursor capsule
    expect(row).toContain('[•普通]'); // applied
    expect(row).toContain('[PTC]');
    expect(row).toContain('将切到 混合');
  });

  it('按键提示不在卡里重复——它归 composer 占位行，卡只放控件', () => {
    const row = modeRow({ select: { index: 0, ptcAvailable: true } });
    expect(row).toContain('当前模式');
    expect(row).not.toContain('将切到');
    expect(row).not.toContain('Enter');
    expect(row).not.toContain('↑↓');
  });

  it('运行时不支持类型剥离时点名 Node 下限', () => {
    expect(modeRow({ select: { index: 1, ptcAvailable: false } })).toContain('需 Node ≥ 22.19');
    expect(modeRow({ select: { index: 0, ptcAvailable: false } })).not.toContain('22.19');
  });

  it('选择器在架不撑宽卡片：塌缩前后同一尺寸，不会跳一下', () => {
    const card = (over: Partial<WelcomeView>) =>
      styledWidth(buildWelcome(plainPalette, base(over))[0]!.trimStart());
    expect(card({ cols: 100, select: { index: 1, ptcAvailable: true } })).toBeLessThanOrEqual(60);
    expect(card({ cols: 100, select: { index: 1, ptcAvailable: true } })).toBe(card({ cols: 100 }));
  });

  it('窄屏整字段降级：先丢尾注、再裁控件，绝不词中截断', () => {
    expect(modeRow({ cols: 100, select: { index: 1, ptcAvailable: true } })).toContain('将切到 PTC');
    const tight = modeRow({ cols: 40, select: { index: 1, ptcAvailable: true } });
    expect(tight).not.toContain('将切到');
    expect(tight).toContain('[•普通]'); // 控件本体留到最后
  });

  it('rows stay within the terminal budget on narrow screens', () => {
    for (const cols of [40, 60, 80]) {
      for (const row of buildWelcome(plainPalette, base({ cols, select: { index: 1, ptcAvailable: true } }))) {
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
