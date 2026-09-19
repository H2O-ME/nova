import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from '@nova-agent/core';
import { styledWidth } from '@nova-agent/tui';
import { createComposer, insert, paste } from '../src/composer.js';
import { CHROME_PAD_COLS, COMPOSER_ROWS } from '../src/layout.js';
import {
  APPROVAL_OPTIONS,
  CARET,
  COMPOSER_PLACEHOLDER,
  approvalCard,
  composerCard,
  fit,
  hintBar,
  listPanel,
  modeSelector,
  queueLane,
  welcomeCard,
} from '../src/panels.js';
import { plainPalette } from '../src/theme.js';

const palette = plainPalette();
const strip = (text: string): string => text.replaceAll(CARET, '').replaceAll('\x1b[0m', '');

describe('composerCard', () => {
  it('is three rows for an empty draft, with the caret on the middle row', () => {
    const view = composerCard({ cols: 80, composer: createComposer(), palette });
    expect(view.lines).toHaveLength(COMPOSER_ROWS);
    expect(view.cursorRow).toBe(1);
    // chrome inset + border + inner pad + `❯ `
    expect(view.cursorCol).toBe(CHROME_PAD_COLS + 1 + 2 + 2);
    expect(strip(view.lines[1]!)).toContain(COMPOSER_PLACEHOLDER);
  });

  it('keeps the caret off the placeholder text', () => {
    const view = composerCard({ cols: 80, composer: createComposer(), palette });
    // Caret cell, one gap cell, then the words — butted against them the caret
    // reads as having eaten the first character.
    expect(view.lines[1]).toContain(`${CARET} \x1b[0m ${COMPOSER_PLACEHOLDER}`);
  });

  it('keeps every row exactly the card width', () => {
    const cols = 90;
    const states = [createComposer(), paste(createComposer(), '一行中文与 ascii 混排的草稿'), paste(createComposer(), 'a'.repeat(400))];
    // Total row width is the shared inset plus the card, i.e. cols - 1: the
    // last column stays unwritten so a glyph can never wrap the row.
    for (const state of states) {
      const view = composerCard({ cols, composer: state, palette });
      for (const line of view.lines) expect(styledWidth(line)).toBe(cols - 1);
    }
  });

  it('grows by a row per newline and keeps the caret on its own row', () => {
    let state = paste(createComposer(), 'first');
    state = paste(state, '\nsecond');
    const view = composerCard({ cols: 80, composer: state, palette });
    expect(view.lines).toHaveLength(COMPOSER_ROWS + 1);
    expect(view.cursorRow).toBe(2);
  });

  it('folds a long paste into a chip and keeps the caret outside it', () => {
    const state = paste(createComposer(), 'x\n'.repeat(20));
    const view = composerCard({ cols: 80, composer: state, palette });
    expect(strip(view.lines[1]!)).toContain('▤ 粘贴 21行');
    expect(view.lines).toHaveLength(COMPOSER_ROWS);
  });

  it('wraps an overlong line and moves the caret to the wrapped row', () => {
    // Typed, not pasted: a paste this long is a chip, and a chip is one row.
    const state = insert(createComposer(), 'y'.repeat(400));
    const view = composerCard({ cols: 40, composer: state, palette });
    expect(view.lines.length).toBeGreaterThan(COMPOSER_ROWS);
    expect(view.cursorRow).toBe(view.lines.length - 2);
    expect(view.cursorCol).toBeLessThan(40);
  });
});

describe('approvalCard', () => {
  const request: ApprovalRequest = {
    id: 'apr1',
    call: {
      id: 'c1',
      name: 'bash',
      args: { command: 'git status' },
      rawArgs: '{"command":"git status"}',
    },
    kind: 'execute',
    view: { card: 'terminal', command: 'git status' },
    preview: ['- old line', '+ new line'],
  };

  it('names the permission kind, the call and the effect preview', () => {
    const lines = approvalCard({ cols: 90, request, cursor: 0, denyReason: '', palette });
    const text = lines.map(strip).join('\n');
    expect(text).toContain('需要审批');
    expect(text).toContain('[执行]');
    expect(text).toContain('$ git status');
    expect(text).toContain('- old line');
    expect(text).toContain('+ new line');
    for (const option of ['本次允许', '总是允许', '拒绝']) expect(text).toContain(option);
  });

  it('marks exactly one option as the cursor', () => {
    for (const [index] of APPROVAL_OPTIONS.entries()) {
      const lines = approvalCard({ cols: 90, request, cursor: index, denyReason: '', palette });
      expect(lines.filter((line) => strip(line).includes('❯')).length).toBe(1);
    }
  });

  it('previews the word range an "always" grant would memorize', () => {
    const lines = approvalCard({
      cols: 90,
      request,
      cursor: 1,
      denyReason: '',
      palette,
      scope: { words: ['git', 'status', '--short'], count: 2 },
    });
    const text = lines.map(strip).join('\n');
    expect(text).toContain('总是允许 · git status');
    expect(text).not.toContain('git status --short');
    expect(text).toContain('记住前 2 个词');
  });

  it('shows a typed denial reason and says what it is for', () => {
    const lines = approvalCard({ cols: 90, request, cursor: 2, denyReason: '走另一条路', palette });
    const text = lines.map(strip).join('\n');
    expect(text).toContain('拒绝：走另一条路');
    expect(text).toContain('模型会收到你的拒绝理由');
  });

  it('keeps every row exactly the card width, preview included', () => {
    const wide: ApprovalRequest = { ...request, preview: ['+ ' + 'z'.repeat(500)] };
    const lines = approvalCard({ cols: 70, request: wide, cursor: 1, denyReason: '', palette });
    for (const line of lines) expect(styledWidth(line)).toBe(69);
  });
});

describe('queueLane', () => {
  it('is absent when nothing is queued', () => {
    expect(queueLane({ cols: 80, items: [], palette })).toEqual([]);
  });

  it('counts the queue and previews the first items', () => {
    const lines = queueLane({ cols: 80, items: ['第一条', '第二条', '第三条'], palette });
    expect(strip(lines[0]!)).toContain('已排队 3 条');
    expect(lines).toHaveLength(1 + 2 + 1);
    expect(strip(lines.at(-1)!)).toContain('还有 1 条');
  });
});

describe('hintBar', () => {
  it('prints the key set of whoever owns the keyboard', () => {
    expect(strip(hintBar({ cols: 120, owner: 'composer', palette }, palette))).toContain('Enter 发送');
    expect(strip(hintBar({ cols: 120, owner: 'running', palette }, palette))).toContain('Esc 中断');
    expect(strip(hintBar({ cols: 120, owner: 'approval', palette }, palette))).toContain('Enter 确认');
  });

  it('prints Tab only when a mode switch is actually available', () => {
    const off = strip(hintBar({ cols: 120, owner: 'composer', palette }, palette));
    const on = strip(hintBar({ cols: 120, owner: 'composer', palette, canSwitchMode: true }, palette));
    expect(off).not.toContain('Tab');
    expect(on).toContain('Tab 模式');
  });

  it('adds the approval keys the cursor row actually has', () => {
    const scope = strip(hintBar({ cols: 120, owner: 'approval', palette, approvalScope: true }, palette));
    const deny = strip(hintBar({ cols: 120, owner: 'approval', palette, denyTyping: true }, palette));
    expect(scope).toContain('←→ 调授权范围');
    expect(scope).not.toContain('打字');
    expect(deny).toContain('打字 补理由');
    expect(deny).toContain('Backspace 删字');
  });

  it('drops whole entries from the tail instead of cutting a key name', () => {
    const line = hintBar({ cols: 30, owner: 'composer', palette }, palette);
    const text = strip(line);
    expect(text).toContain('Enter 发送');
    expect(text).not.toContain('Shift+Enter');
    expect(text).not.toContain('…');
    expect(styledWidth(line)).toBeLessThanOrEqual(29);
  });
});

describe('welcomeCard', () => {
  const base = {
    cols: 100,
    rootDir: 'D:\\web\\agent',
    sessionsDir: '~/.nova/sessions',
    skills: 3,
    mode: 'native' as const,
    palette,
  };

  it('carries the facts nothing else shows', () => {
    const text = welcomeCard(base).map(strip).join('\n');
    expect(text).toContain('工作区');
    expect(text).toContain('D:\\web\\agent');
    expect(text).toContain('~/.nova/sessions');
    expect(text).toContain('3 个');
    expect(text).toContain('容器');
  });

  it('centers horizontally and keeps one width for every row', () => {
    const lines = welcomeCard(base);
    const widths = new Set(lines.map((line) => styledWidth(line)));
    expect(widths.size).toBe(1);
    expect(styledWidth(lines[0]!)).toBeLessThan(base.cols);
    expect(lines[0]!.startsWith(' ')).toBe(true);
  });

  it('never repeats the identity trio the status bar owns', () => {
    const text = welcomeCard({ ...base, mode: 'ptc' }).map(strip).join('\n');
    expect(text).not.toContain('只读');
    expect(text).not.toContain('审批');
    expect(text).toContain('PTC');
  });

  it('sizes every selector segment the same, capsule included', () => {
    const segments = modeSelector('ptc', palette).split('│').map((segment) => segment.trim());
    expect(segments).toHaveLength(3);
    expect(new Set(segments.map((segment) => styledWidth(segment)))).toEqual(new Set([8]));
    expect(segments[1]).toContain('PTC');
  });
});

describe('listPanel', () => {
  const rows = ['/help', '/model', '/session', '/plugins', '/theme'].map((label) => ({ label }));

  it('marks the cursor row and windows the list', () => {
    const lines = listPanel({ cols: 80, title: '命令', rows, cursor: 2, offset: 2, maxRows: 2, palette });
    const text = lines.map(strip).join('\n');
    expect(text).toContain('❯ /session');
    expect(text).toContain('/plugins');
    expect(text).toContain('4/5');
    expect(text).not.toContain('/help');
    expect(text).not.toContain('/theme');
  });

  it('keeps the card width when the title is long', () => {
    const lines = listPanel({ cols: 60, title: '一个非常长的面板标题占满整行', rows, cursor: 0, maxRows: 3, palette });
    for (const line of lines) expect(styledWidth(line)).toBe(59);
  });
});

describe('fit', () => {
  it('counts CJK as two columns', () => {
    expect(fit('中文字符串', 4)).toBe('中…');
    expect(fit('abcdef', 4)).toBe('abc…');
    expect(fit('abc', 4)).toBe('abc');
  });
});