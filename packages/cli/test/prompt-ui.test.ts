import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, DEFAULT_SYSTEM_PROMPT } from '../src/system-prompt.js';
import { createMarkdownRenderer, renderMarkdownLite } from '../src/markdown.js';
import {
  contextBar,
  isReadOnlyTool,
  plainPalette,
  statusLine,
  toolArgSummary,
  toolDoneLine,
  toolGroupLine,
  toolStartLine,
  type Palette,
} from '../src/ui.js';

describe('system prompt', () => {
  it('forbids tool use on greetings and unsolicited work', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/Do NOT call any tools/);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/only when the user asks for it/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/do not invent follow-up work/i);
    expect(DEFAULT_SYSTEM_PROMPT).toMatch(/Mirror the user's language/);
  });

  it('stays byte-stable: no environment or user instructions baked in', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(prompt).not.toContain('platform=');
    expect(prompt).not.toContain('## User instructions');
    // the fragment contract is documented in the prompt itself
    expect(prompt).toContain('<environment>');
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('mcp__<server>__<tool>');
  });
});

const p: Palette = plainPalette;

describe('ui helpers', () => {
  it('summarizes tool args by key field instead of raw JSON', () => {
    expect(toolArgSummary('bash', '{"command":"echo hi"}')).toBe('echo hi');
    expect(toolArgSummary('read_file', '{"path":"src/a.ts"}')).toBe('src/a.ts');
    expect(toolArgSummary('jobs', '{"action":"stop","id":"bash-1"}')).toBe('stop bash-1');
    expect(toolArgSummary('todo_write', '{"todos":[{"content":"a","status":"pending"}]}')).toBe('1 项待办');
    expect(toolArgSummary('t', 'not json')).toBe('not json');
    expect(toolArgSummary('bash', `{"command":"${'x'.repeat(200)}"}`)).toContain('…');
  });

  it('formats the running tool line as a one-line summary', () => {
    expect(toolStartLine(p, 'bash', '{"command":"echo hi"}')).toBe('    • 执行命令 echo hi');
    expect(toolStartLine(p, 'read_file', '{"path":"a.txt"}')).toContain('读取文件');
    expect(toolStartLine(p, 'read_file', '{"path":"a.txt"}')).not.toContain('{');
    expect(toolStartLine(p, 'bash', '{"command":"echo hi"}', '⠙')).toContain('⠙');
  });

  it('classifies read-only tools and renders the exploration group line', () => {
    expect(isReadOnlyTool('read_file')).toBe(true);
    expect(isReadOnlyTool('list_dir')).toBe(true);
    expect(isReadOnlyTool('bash')).toBe(false);

    const group = toolGroupLine(p, ['a.ts', 'b.ts', 'c.ts'], 500);
    expect(group).toContain('✓');
    expect(group).toContain('查看');
    expect(group).toContain('a.ts, b.ts, c.ts');
    expect(group).toContain('3 次');
    expect(group).toContain('0.5s');

    const long = toolGroupLine(p, ['x'.repeat(100), 'y.ts'], 100);
    expect(long).toContain('…');
  });

  it('collapses successful tool results to one line', () => {
    const multi = toolDoneLine(p, 'read_file', '{"path":"a.txt"}', 'line1\nline2\nline3\nline4', 420);
    expect(multi).toHaveLength(1);
    expect(multi[0]).toContain('✓');
    expect(multi[0]).toContain('读取文件');
    expect(multi[0]).toContain('a.txt');
    expect(multi[0]).toContain('4 行');
    expect(multi[0]).toContain('0.4s');

    const single = toolDoneLine(p, 'write_file', '{"path":"a.txt"}', 'wrote 5 bytes', 100);
    expect(single).toHaveLength(1);
    expect(single[0]).toContain('wrote 5 bytes');

    const empty = toolDoneLine(p, 'bash', '{"command":"true"}', 'exit: 0', 50);
    expect(empty).toHaveLength(1);
    expect(empty[0]).toContain('✓');
  });

  it('expands failed tool results with the first error line', () => {
    const failed = toolDoneLine(p, 'bash', '{"command":"pnpm test"}', 'exit: 1\nboom happened', 3200);
    expect(failed).toHaveLength(2);
    expect(failed[0]).toContain('✗');
    expect(failed[0]).toContain('pnpm test');
    expect(failed[1]).toContain('boom happened');

    const errored = toolDoneLine(p, 'read_file', '{"path":"x"}', 'Error: file not found', 10);
    expect(errored[0]).toContain('✗');
  });

  it('formats the status line with cache hit and stop word', () => {
    const line = statusLine(
      p,
      'complete',
      { turns: 2, promptTokens: 2906, completionTokens: 132, cachedTokens: 1536 },
      4200,
    );
    expect(line).toContain('✓ 完成');
    expect(line).toContain('2 轮');
    expect(line).toContain('↑2.9k ↓132 tok');
    expect(line).toContain('缓存 53%');
    expect(line).toContain('4.2s');

    const aborted = statusLine(p, 'aborted', { turns: 1, promptTokens: 0, completionTokens: 0, cachedTokens: 0 }, 100);
    expect(aborted).toContain('■ 已中断');
    expect(aborted).toContain('缓存 0%');
  });

  it('renders the context pressure bar with clamping', () => {
    expect(contextBar(0.5, 8)).toBe('████░░░░');
    expect(contextBar(0, 8)).toBe('░░░░░░░░');
    expect(contextBar(1.4, 8)).toBe('████████');
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
    expect(lines).toEqual(['标题', '', '· 第一项', '· 第二项', 'code();']);
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
