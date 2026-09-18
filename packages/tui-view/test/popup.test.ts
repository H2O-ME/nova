/**
 * 弹窗纯构建器单测：四态的行结构、滑动窗口、选中行反色、窄列恒单行。
 * plainPalette 得无 ANSI 字符串做结构断言；palette 下探 ANSI。
 */

import { styledWidth } from '@nova-agent/tui';
import { describe, expect, it } from 'vitest';
import { CHROME_PAD_COLS, composerCardWidth, palette, plainPalette } from '../src/index.js';
import {
  APPROVAL_OPTIONS,
  buildApprovalPopup,
  buildCommandPopup,
  buildModelPopup,
  buildSessionPopup,
  MODEL_PICKER_WINDOW,
} from '../src/index.js';

/**
 * 弹窗卡片与输入卡片同宽同边距——"整屏一条左缘"的可执行定义。
 * 断言绑在 composer 的宽度函数上：谁改内衬，两边一起红，而不是各留一个魔数。
 */
const cardRowWidth = (cols: number): number => composerCardWidth(cols) + CHROME_PAD_COLS;

describe('buildApprovalPopup', () => {
  const view = {
    permissionLabel: '执行',
    toolLabel: '执行命令',
    argSummary: 'pnpm install',
    previewLines: ['--- a.ts', '+++ b.ts', '+ new line'],
    index: 1,
  };

  /** 顶框 + 头部 + 三个选项 + 底框（预览行数另计）。 */
  const bare = (over: Partial<typeof view> = {}) =>
    buildApprovalPopup(plainPalette, { ...view, previewLines: undefined, ...over }, 80);

  it('并入卡片语言：每行恒等于 cols-1，绝不折行也绝不让右边框错位', () => {
    for (const cols of [40, 60, 120]) {
      const lines = buildApprovalPopup(plainPalette, { ...view, argSummary: 'x'.repeat(300) }, cols);
      for (const line of lines) expect(styledWidth(line)).toBe(cardRowWidth(cols));
    }
  });

  it('标题栏承载告警与权限类别，正文首行是工具与参数摘要', () => {
    const lines = bare();
    expect(lines[0]).toContain('! 需要审批');
    expect(lines[0]).toContain('[执行]');
    expect(lines[1]).toContain('执行命令 pnpm install');
  });

  it('三个选项按 y/a/n 排列、光标行带 ❯；键位不进弹窗（归底部快捷键条）', () => {
    const lines = bare();
    expect(lines).toHaveLength(6); // 顶框 + 头部 + 3 选项 + 底框
    expect(lines[2]).toContain('允许一次');
    expect(lines[3]).toContain('❯ 总是允许');
    expect(lines[4]).toContain('拒绝');
    expect(lines[2]).not.toContain('❯');
    expect(lines.join('\n')).not.toContain('Esc');
    expect(lines.join('\n').toLowerCase()).not.toContain('enter');
  });

  it('光标行整行反色——那条色带才是"这是个控件"的信号', () => {
    const lines = buildApprovalPopup(palette, { ...view, previewLines: undefined }, 80);
    expect(lines[3]).toContain('\x1b[7m');
    expect(lines[2]).not.toContain('\x1b[7m');
    expect(lines[0]).toContain('\x1b[33m'); // 告警仍黄
  });

  it('执行类审批的授权语义走卡片脚边，行数不随它增减', () => {
    const exec = bare({ isExecuteKind: true });
    expect(exec.at(-1)).toContain('「总是允许」按命令程序前缀记忆');
    expect(exec).toHaveLength(6);
    expect(bare({ isExecuteKind: false }).at(-1)).not.toContain('前缀记忆');
  });

  it('always 行带实时前 N 词预览（M10 组件6）；范围在架时语义行让位', () => {
    const scoped = bare({
      isExecuteKind: true,
      alwaysScope: { words: 2, total: 4, prefix: 'git status' },
    });
    expect(scoped[3]).toContain('总是允许 前2/4词：git status');
    expect(scoped.at(-1)).not.toContain('前缀记忆'); // 预览本身就是内容
    // 非选中行同样带预览（范围是当前状态，不是选中态装饰）。
    expect(
      bare({ index: 0, alwaysScope: { words: 1, total: 4, prefix: 'git' } })[3],
    ).toContain('总是允许 前1/4词：git');
  });

  it('范围预览与摘要都在框内裁剪：窄列不撑破卡片', () => {
    const lines = bare({
      argSummary: 'pnpm install --filter @nova-agent/cli --no-frozen-lockfile-and-more',
      isExecuteKind: true,
      alwaysScope: { words: 2, total: 6, prefix: 'pnpm workspace run filter '.repeat(8) },
    });
    for (const line of lines) expect(styledWidth(line)).toBe(cardRowWidth(80));
    expect(lines[3]).toContain('…');
  });

  it('拒绝行打字转追问：理由上屏、聚焦占位（M10 组件7）', () => {
    expect(bare({ index: 2, denyNote: { text: '别碰 CI', focused: true } })[4]).toContain('拒绝：别碰 CI');
    expect(bare({ index: 2, denyNote: { text: '', focused: true } })[4]).toContain('拒绝（打字补充理由）');
    const plain = bare({ index: 0, denyNote: { text: '', focused: false } });
    expect(plain[4]).toContain('拒绝');
    expect(plain[4]).not.toContain('打字');
    expect(plain[4]).not.toContain('❯');
  });

  it('预览行留在卡片内（diff / 目标预览），且恒单行', () => {
    const lines = buildApprovalPopup(
      plainPalette,
      { ...view, previewLines: ['+ '.repeat(200), '- '.repeat(200)] },
      50,
    );
    for (const line of lines) expect(styledWidth(line)).toBe(cardRowWidth(50));
    expect(lines[1]).toContain('执行命令');
    expect(lines[2]).toContain('+'); // 预览行留在框内且被裁进内宽
    expect(lines[3]).toContain('-');
  });

  it('approval options stay y/a/n-ordered', () => {
    expect(APPROVAL_OPTIONS.map((o) => o.code)).toEqual(['allow', 'always', 'deny']);
    expect(APPROVAL_OPTIONS.map((o) => o.label)).toEqual(['允许一次', '总是允许', '拒绝']);
  });
});

describe('framed panels (model/session/command)', () => {
  it('frame width always equals cols-1 regardless of content', () => {
    const cols = 60;
    const items = Array.from({ length: 30 }, (_, i) => ({ name: `model-${i}`, contextTokens: i * 1000 }));
    const lines = buildModelPopup(plainPalette, { items, index: 0, current: 'model-0' }, cols);
    for (const line of lines) expect(styledWidth(line)).toBe(cardRowWidth(cols));
  });

  it('session rows clip the title (stamp/suffix survive); frame rows are exactly cols-1', () => {
    const cols = 50;
    const sessions = Array.from({ length: 20 }, (_, i) => ({ mtime: 1_700_000_000_000 + i, title: `会话标题很长很长很长${i}`, isCurrent: i === 3 }));
    const s = buildSessionPopup(plainPalette, { items: sessions, index: 3 }, cols);
    for (const line of s) expect(styledWidth(line)).toBe(cardRowWidth(cols)); // 内容行由 padDisplay 铺满到内宽
    expect(s[4]).toContain('（当前）'); // 窗口从 idx 0 起，当前会话在 idx 3（第 4 内容行）
    expect(s[1]).toContain(' 1. '); // 组件7：绝对编号前缀（数字键可直达）
    expect(s[4]).toContain(' 4. ');
  });

  it('command frame rows are exactly cols-1; usage column pad-aligns', () => {
    const cols = 50;
    const cmds = buildCommandPopup(plainPalette, { matches: [{ usage: '[x]', description: '描述' }, { usage: '[name] [arg]', description: '另一条' }], index: 0 }, cols);
    expect(styledWidth(cmds[0]!)).toBe(cardRowWidth(cols));
    expect(styledWidth(cmds.at(-1)!)).toBe(cardRowWidth(cols));
    expect(cmds[1]).toContain('[x]                    '); // padDisplay(22)
  });

  it('三张选择卡都不印键位——快捷键条是唯一的键位面（同一件事不说两遍）', () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ name: `m${i}`, contextTokens: undefined }));
    const sessions = Array.from({ length: 5 }, (_, i) => ({ mtime: i, title: `t${i}`, isCurrent: false }));
    const cmds = [{ usage: '[x]', description: '描述' }];
    const cards = [
      buildModelPopup(plainPalette, { items, index: 0, current: 'm0' }, 80),
      buildSessionPopup(plainPalette, { items: sessions, index: 0 }, 80),
      buildCommandPopup(plainPalette, { matches: cmds, index: 0 }, 80),
    ];
    for (const card of cards) {
      const text = card.join('\n');
      for (const key of ['↑', '↓', 'Esc', 'Tab', 'Enter']) expect(text).not.toContain(key);
    }
  });
});

describe('model popup window', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ name: `model-${i}`, contextTokens: undefined }));

  it('shows a sliding MODEL_PICKER_WINDOW and keeps the cursor visible', () => {
    expect(MODEL_PICKER_WINDOW).toBe(10);
    const head = buildModelPopup(plainPalette, { items, index: 0, current: 'model-0' }, 100);
    const tail = buildModelPopup(plainPalette, { items, index: 29, current: 'model-0' }, 100);
    expect(head).toHaveLength(12); // 10 rows + 边框上下
    expect(head[1]).toContain('1. model-0');
    // 窗口起点 = min(29-9, 30-10) = 20：首行 model-20，❯ 在末行 model-29。
    expect(tail[1]).toContain('21. model-20');
    expect(tail[10]).toContain('❯');
    expect(tail.some((l) => l.includes('30. model-29'))).toBe(true);
    expect(head.some((l) => l.includes('30. model-29'))).toBe(false);
  });

  it('marks the current model and appends the ctx tag from metadata', () => {
    const lines = buildModelPopup(
      plainPalette,
      { items: [{ name: 'm-a', contextTokens: 200_000 }, { name: 'm-b', contextTokens: undefined }], index: 0, current: 'm-a' },
      100,
    );
    // padDisplay 不参与 name 段；'（当前）' 与 ctx 标之间是原文里的空格。
    expect(lines[1]).toContain('1. m-a（当前） · 200k tok');
    expect(lines[2]).not.toContain('tok');
  });

  it('selected row is inverse-video in color mode', () => {
    const lines = buildModelPopup(palette, { items, index: 0, current: '' }, 100);
    expect(lines[1]).toContain('\x1b[7m');
    expect(lines[2]).not.toContain('\x1b[7m');
  });
});

describe('session popup', () => {
  it('clips the title at segment boundaries keeping the stamp and (当前) suffix', () => {
    const cols = 50;
    const lines = buildSessionPopup(
      plainPalette,
      { items: [{ mtime: 0, title: '超'.repeat(60), isCurrent: true }], index: 0 },
      cols,
    );
    expect(lines[1]).toContain('（当前）'); // 后缀恒留
    expect(styledWidth(lines[1]!)).toBe(cardRowWidth(cols));
  });
});

describe('command popup', () => {
  it('highlights slide within a 6-row window; usage column is padded', () => {
    const matches = Array.from({ length: 10 }, (_, i) => ({ usage: `[arg${i}]`, description: `desc ${i}` }));
    const lines = buildCommandPopup(plainPalette, { matches, index: 8 }, 80);
    expect(lines).toHaveLength(8); // 6 rows + 边框上下
    // 窗口起点 = min(8-5, 10-6) = 3：首行 desc 3，选中行 desc 8（第 6 内容行）。
    // 命令面板的选中态是**整行反色**（原版行为：无行首 ❯，模型/会话面板才有）。
    expect(lines[1]).toContain('desc 3');
    expect(lines[6]).toContain('desc 8');
    expect(buildCommandPopup(palette, { matches, index: 8 }, 80)[6]).toContain('\x1b[7m');
    expect(lines[1]).toMatch(/ {2,}\[arg3\]/); // padDisplay(22) 对齐
  });

  it('empty match list yields just the frame (rows collapse)', () => {
    const lines = buildCommandPopup(plainPalette, { matches: [], index: 0 }, 80);
    expect(lines).toHaveLength(2);
  });
});
