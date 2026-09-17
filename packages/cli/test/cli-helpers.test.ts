/**
 * CLI-only helpers (not re-exported through @nova-agent/tui-view):
 * system prompt byte-stability, markdown-lite rendering, and the
 * Windows toast PowerShell script. The shared view helpers
 * (statusbar / composer / popup / reasoning / context gauge) are tested
 * once in packages/tui-view/test/ — re-testing them here only duplicated
 * coverage of thin façade re-exports.
 */
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT } from '../src/system-prompt.js';
import { createMarkdownRenderer, renderMarkdownLite } from '../src/markdown.js';
import { buildWindowsToastScript } from '../src/notify.js';
import { plainPalette } from '@nova-agent/tui-view';

describe('system prompt', () => {
  it('forbids tool use on greetings and unsolicited work', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/Do NOT call any tools/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/only when the user asks for it/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/do not invent follow-up work/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/Mirror the user's language/);
  });

  it('frames subagents as context isolation, never design delegation', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/CONTEXT-ISOLATION tool/);
    // codex 编排经验：侦察默认只读、brief 不重叠、设计/实现留在主代理。
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/1–2 scout subagents/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/NEVER delegate design or complex implementation/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/re-search the same question/);
  });

  it('stays byte-stable: no environment or user instructions baked in', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(prompt).not.toContain('platform=');
    expect(prompt).not.toContain('## User instructions');
    // the fragment contract is documented in the prompt itself
    expect(prompt).toContain('<environment>');
    expect(prompt).toContain('<available_skills>');
  });
});

describe('markdown lite', () => {
  const p = plainPalette;

  it('strips inline markdown symbols', () => {
    const lines = renderMarkdownLite('run `pnpm test` and **verify** the output', p);
    expect(lines).toEqual(['run pnpm test and verify the output']);
  });

  it('normalizes bullets and headings, hides fence markers', () => {
    const lines = renderMarkdownLite('# 标题\n\n- 第一项\n* 第二项\n```js\ncode();\n```', p);
    // 列表项缩进 2 列挂圆点（与正文同列读不出层级）；wrapBlock 把前导空格
    // 算进悬挂缩进，换行续行对齐条目文本列。
    expect(lines).toEqual(['标题', '', '  · 第一项', '  · 第二项', 'code();']);
    expect(renderMarkdownLite('  - 嵌套项', p)).toEqual(['    · 嵌套项']);
  });

  it('keeps plain paragraphs byte-identical', () => {
    expect(renderMarkdownLite('你好\n世界', p)).toEqual(['你好', '世界']);
  });

  it('streams incrementally: complete lines cache, only the tail re-renders', () => {
    const md = createMarkdownRenderer(p);
    expect(md.push('# 标题\n')).toEqual(['标题']);
    expect(md.push('第一行\n第二')).toEqual(['标题', '第一行', '第二']);
    expect(md.push('行')).toEqual(['标题', '第一行', '第二行']);
    // A partially typed fence marker must not toggle fence state early and
    // leaves no premature output; the committed newline confirms the line.
    expect(md.push('\n```')).toEqual(['标题', '第一行', '第二行']);
    expect(md.push('`\ncode();\n```\n')).toEqual(['标题', '第一行', '第二行', 'code();']);
    // A new open fence renders its lines dim; the state survives pushes.
    expect(md.push('```js\nconst x = 1;\n')).toEqual(['标题', '第一行', '第二行', 'code();', 'const x = 1;']);
  });
});

describe('windows toast script', () => {
  it('escapes quotes and flattens newlines for the PowerShell string literals', () => {
    const script = buildWindowsToastScript('Nova', "it's done\nline2");
    expect(script).toContain("$t='Nova'");
    expect(script).toContain("$b='it''s done line2'");
    expect(script).toContain('ToastNotificationManager');
    expect(script).toContain('ShowBalloonTip'); // balloon fallback present
  });
});

describe('markdown inline: code span / bold isolation', () => {
  it('bold never matches across a code span (placeholder extraction)', () => {
    // Marker palette makes the wrapping observable in plain text.
    const p = {
      ...plainPalette,
      cyan: (text: string) => `<c>${text}</c>`,
      bold: (text: string) => `<b>${text}</b>`,
    };
    const lines = renderMarkdownLite('use `a**b` and **c** now', p as typeof plainPalette);
    expect(lines).toEqual(['use <c>a**b</c> and <b>c</b> now']);
  });
});
