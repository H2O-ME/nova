/**
 * 弹窗纯构建器单测：四态的行结构、滑动窗口、选中行反色、窄列恒单行。
 * plainPalette 得无 ANSI 字符串做结构断言；palette 下探 ANSI。
 */

import { styledWidth } from '@nova-agent/tui';
import { describe, expect, it } from 'vitest';
import { palette, plainPalette } from '../src/index.js';
import {
  APPROVAL_OPTIONS,
  buildApprovalPopup,
  buildCommandPopup,
  buildModelPopup,
  buildSessionPopup,
  MODEL_PICKER_WINDOW,
} from '../src/index.js';

describe('buildApprovalPopup', () => {
  const view = {
    permissionLabel: '执行',
    toolLabel: '执行命令',
    argSummary: 'pnpm install',
    previewLines: ['--- a.ts', '+++ b.ts', '+ new line'],
    index: 1,
  };

  it('header clips the arg summary to the remaining columns (12-col floor); preview rows clip too', () => {
    const long = { ...view, argSummary: 'pnpm install --filter @nova-agent/cli --no-frozen-lockfile' };
    const lines = buildApprovalPopup(plainPalette, long, 40);
    // 头部预算 = max(12, cols-1-headPlain宽)；40 列下取下限 12 → 'pnpm insta…'。
    expect(lines[0]).toBe('  ! 需要审批 [执行] 执行命令 pnpm insta…');
    expect(lines[1]).toBe('  --- a.ts');
  });

  it('三个选项 + 选中态标记；键位不再出现在弹窗里（归底部快捷键条）', () => {
    const lines = buildApprovalPopup(plainPalette, { ...view, previewLines: undefined }, 80);
    expect(lines).toHaveLength(4); // header + 3 options
    expect(lines[1]).toBe('    允许一次');
    expect(lines[2]).toBe('  ❯ 总是允许');
    expect(lines[3]).toBe('    拒绝');
    expect(lines.join('\n')).not.toContain('Esc');
    expect(lines.join('\n')).not.toContain('Enter');
  });

  it('执行类审批才留一句授权语义（不是键位说明）', () => {
    const exec = buildApprovalPopup(plainPalette, { ...view, previewLines: undefined, isExecuteKind: true }, 80);
    expect(exec).toHaveLength(5);
    expect(exec[4]).toContain('「总是允许」按命令程序前缀记忆');
    const other = buildApprovalPopup(plainPalette, { ...view, previewLines: undefined, isExecuteKind: false }, 80);
    expect(other).toHaveLength(4);
  });

  it('always 行带实时前 N 词预览（M10 组件6）；范围在架时语义行让位', () => {
    const scoped = buildApprovalPopup(plainPalette, {
      ...view,
      previewLines: undefined,
      isExecuteKind: true,
      alwaysScope: { words: 2, total: 4, prefix: 'git status' },
    }, 80);
    expect(scoped[2]).toBe('  ❯ 总是允许 前2/4词：git status');
    expect(scoped).toHaveLength(4); // 预览本身就是内容，不再挂提示行
    // 非选中行同样带预览（范围是当前状态，不是选中态装饰）。
    const offSel = buildApprovalPopup(plainPalette, {
      ...view,
      previewLines: undefined,
      index: 0,
      alwaysScope: { words: 1, total: 4, prefix: 'git' },
    }, 80);
    expect(offSel[2]).toContain('总是允许 前1/4词：git');
  });

  it('scope preview clips into the row budget at narrow cols', () => {
    // cols=30 时头部 12 列摘要下限本就溢出（弹窗既有债务）；40 列验证导轨范围行的裁剪。
    const lines = buildApprovalPopup(plainPalette, {
      ...view,
      argSummary: 'pnpm i',
      previewLines: undefined,
      isExecuteKind: true,
      alwaysScope: { words: 2, total: 6, prefix: 'pnpm workspace run filter' },
    }, 40);
    for (const line of lines) expect(styledWidth(line)).toBeLessThanOrEqual(39);
    expect(lines[2]).toContain('…');
  });

  it('拒绝行打字转追问：理由上屏、聚焦提示行与占位（M10 组件7）', () => {
    const typed = buildApprovalPopup(plainPalette, {
      ...view,
      previewLines: undefined,
      index: 2,
      denyNote: { text: '别碰 CI', focused: true },
    }, 80);
    expect(typed[3]).toBe('  ❯ 拒绝：别碰 CI');
    expect(typed).toHaveLength(4); // 键位（打字/⌫）归底部快捷键条，弹窗不再重复
    // 空理由 + 聚焦：占位提示打字；失焦回到原文案。
    const focused = buildApprovalPopup(plainPalette, {
      ...view,
      previewLines: undefined,
      index: 2,
      denyNote: { text: '', focused: true },
    }, 80);
    expect(focused[3]).toContain('拒绝（打字补充理由）');
    const unfocused = buildApprovalPopup(plainPalette, {
      ...view,
      previewLines: undefined,
      index: 0,
      denyNote: { text: '', focused: false },
    }, 80);
    expect(unfocused[3]).toBe('    拒绝');
    expect(unfocused).toHaveLength(4); // 无提示行：键位归底部快捷键条
  });

  it('approval options stay y/a/n-ordered', () => {
    expect(APPROVAL_OPTIONS.map((o) => o.code)).toEqual(['allow', 'always', 'deny']);
    expect(APPROVAL_OPTIONS.map((o) => o.label)).toEqual(['允许一次', '总是允许', '拒绝']);
  });

  it('never wraps even with a long diff preview at narrow cols', () => {
    const lines = buildApprovalPopup(
      plainPalette,
      { ...view, previewLines: ['+ '.repeat(200), '- '.repeat(200)] },
      50,
    );
    for (const line of lines) expect(styledWidth(line)).toBeLessThanOrEqual(50 - 1);
  });

  it('warns in yellow/bold in color mode', () => {
    const lines = buildApprovalPopup(palette, { ...view, previewLines: undefined }, 80);
    expect(lines[0]).toContain('\x1b[33m\x1b[1m! 需要审批');
  });
});

describe('framed panels (model/session/command)', () => {
  it('frame width always equals cols-1 regardless of content', () => {
    const cols = 60;
    const items = Array.from({ length: 30 }, (_, i) => ({ name: `model-${i}`, contextTokens: i * 1000 }));
    const lines = buildModelPopup(plainPalette, { items, index: 0, current: 'model-0' }, cols);
    for (const line of lines) expect(styledWidth(line)).toBe(cols - 1);
  });

  it('session rows clip the title (stamp/suffix survive); frame rows are exactly cols-1', () => {
    const cols = 50;
    const sessions = Array.from({ length: 20 }, (_, i) => ({ mtime: 1_700_000_000_000 + i, title: `会话标题很长很长很长${i}`, isCurrent: i === 3 }));
    const s = buildSessionPopup(plainPalette, { items: sessions, index: 3 }, cols);
    for (const line of s) expect(styledWidth(line)).toBe(cols - 1); // 内容行由 padDisplay 铺满到内宽
    expect(s[4]).toContain('（当前）'); // 窗口从 idx 0 起，当前会话在 idx 3（第 4 内容行）
    expect(s[1]).toContain(' 1. '); // 组件7：绝对编号前缀（数字键可直达）
    expect(s[4]).toContain(' 4. ');
  });

  it('command frame rows are exactly cols-1; usage column pad-aligns', () => {
    const cols = 50;
    const cmds = buildCommandPopup(plainPalette, { matches: [{ usage: '[x]', description: '描述' }, { usage: '[name] [arg]', description: '另一条' }], index: 0 }, cols);
    expect(styledWidth(cmds[0]!)).toBe(cols - 1);
    expect(styledWidth(cmds.at(-1)!)).toBe(cols - 1);
    expect(cmds[1]).toContain('[x]                    '); // padDisplay(22)
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
    expect(styledWidth(lines[1]!)).toBe(cols - 1);
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
