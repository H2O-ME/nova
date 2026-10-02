/**
 * The process group's words (`process-summary.ts`): the classification map,
 * the closed title's composition (ranked top-3, 并/，等, the shared 已 prefix),
 * and the live title's detail extraction. The harness ports these rules
 * verbatim; this file is where a vocabulary drift goes red.
 */
import { describe, expect, it } from 'vitest';
import {
  liveTitleOf,
  processActivityOf,
  processTitle,
  type ProcessSpanBlock,
} from '../src/chat/process-summary.js';

const tool = (name: string, over: Partial<ProcessSpanBlock> = {}): ProcessSpanBlock =>
  ({ kind: 'tool', name, ...over });

describe('processActivityOf', () => {
  it('maps every first-party tool name to its category and the rest to 已调用工具', () => {
    const summary = processActivityOf([
      tool('read_file'),
      tool('search_files'),
      tool('write_file'),
      tool('edit_file'),
      tool('bash'),
      tool('run_code'),
      tool('web_search'),
      tool('web_fetch'),
      tool('subagent'),
      tool('subagent_review'),
      tool('todo_write'),
      tool('ask_user_question'),
      tool('mystery_tool'),
    ]);
    expect(Object.fromEntries(summary.counts.map(({ kind, count }) => [kind, count]))).toEqual({
      read: 1,
      search: 1,
      write: 1,
      edit: 1,
      commands: 1,
      code: 1,
      webSearch: 1,
      webFetch: 1,
      subagents: 2,
      plan: 1,
      questions: 1,
      tools: 1,
    });
  });

  it('ranks count-descending and breaks ties by first appearance', () => {
    const summary = processActivityOf([
      tool('bash'),
      tool('read_file'),
      tool('bash'),
      tool('search_files'),
      tool('read_file'),
    ]);
    // bash and read tie at 2 — bash appeared first; search (1) trails.
    expect(summary.counts.map(({ kind }) => kind)).toEqual(['commands', 'read', 'search']);
    expect(summary.counts.map(({ count }) => count)).toEqual([2, 2, 1]);
  });

  it('reports the in-flight call as running with its first meaningful arg', () => {
    const summary = processActivityOf([
      tool('read_file', { running: false }),
      tool('bash', { running: true, args: '{"command":"git status"}' }),
    ]);
    expect(summary.running).toBe('commands');
    expect(summary.runningDetail).toBe('git status');
  });

  it('with no running call the live detail falls back to the newest finished thought', () => {
    const summary = processActivityOf([
      tool('read_file'),
      { kind: 'reasoning', text: '第一段\n\n**第二段**' },
    ]);
    expect(summary.running).toBeUndefined();
    expect(summary.runningDetail).toBe('第二段');
  });

  it('ignores non-tool, unnamed and reasoning blocks when counting', () => {
    const summary = processActivityOf([
      { kind: 'text', text: '正文' },
      { kind: 'reasoning', text: '想' },
      { kind: 'tool' },
    ]);
    expect(summary.counts).toEqual([]);
    expect(summary.running).toBeUndefined();
  });
});

describe('processTitle', () => {
  it('names one category alone, two with 并, three with commas', () => {
    expect(processTitle(processActivityOf([tool('read_file')]))).toBe('已读取文件');
    expect(processTitle(processActivityOf([tool('read_file'), tool('bash')]))).toBe('已读取文件并执行了命令');
    const three = processActivityOf([tool('read_file'), tool('bash'), tool('search_files')]);
    expect(processTitle(three)).toBe('已读取文件，执行了命令，已搜索代码');
  });

  it('drops the shared 已 prefix from the second label only when both carry it', () => {
    const both = processActivityOf([tool('read_file'), tool('search_files')]);
    expect(processTitle(both)).toBe('已读取文件并搜索代码');
    // 修改了文件 does not carry the prefix, so the second keeps its 已.
    const mixed = processActivityOf([tool('edit_file'), tool('write_file')]);
    expect(processTitle(mixed)).toBe('修改了文件并已写入文件');
  });

  it('closes with 等 only past three categories and falls back to 已完成分析', () => {
    const four = processActivityOf([tool('read_file'), tool('bash'), tool('search_files'), tool('write_file')]);
    expect(processTitle(four)).toBe('已读取文件，执行了命令，已搜索代码等');
    expect(processTitle(processActivityOf([]))).toBe('已完成分析');
  });

  it('keeps the ranking through the title (a count-heavy category leads)', () => {
    const heavy = processActivityOf([tool('bash'), tool('read_file'), tool('bash')]);
    expect(processTitle(heavy)).toBe('执行了命令并已读取文件');
  });
});

describe('liveTitleOf', () => {
  it('names the running activity with its detail only when the policy shows it', () => {
    const running = processActivityOf([tool('bash', { running: true, args: '{"command":"pnpm test"}' })]);
    expect(liveTitleOf(running, false)).toBe('正在运行命令');
    expect(liveTitleOf(running, true)).toBe('正在运行命令 · pnpm test');
  });

  it('reads no running call as analyzing, with the thought as its detail', () => {
    const thinking = processActivityOf([{ kind: 'reasoning', text: '先看结构' }]);
    expect(liveTitleOf(thinking, false)).toBe('正在分析请求');
    expect(liveTitleOf(thinking, true)).toBe('正在分析请求 · 先看结构');
  });
});

describe('live detail extraction', () => {
  it('walks the args-key priority list and caps on code points', () => {
    // `description` outranks `command` in the priority list.
    const both = processActivityOf([
      tool('bash', { running: true, args: '{"command":"x","description":"装依赖"}' }),
    ]);
    expect(liveTitleOf(both, true)).toBe('正在运行命令 · 装依赖');
    // A 200-code-point command is cut to 160 with an ellipsis (159 + …).
    const long = 'a'.repeat(200);
    const capped = processActivityOf([tool('bash', { running: true, args: `{"command":"${long}"}` })]);
    const detail = liveTitleOf(capped, true).replace('正在运行命令 · ', '');
    expect(Array.from(detail)).toHaveLength(160);
    expect(detail.endsWith('…')).toBe(true);
  });

  it('survives malformed args by falling back to the tool name', () => {
    const broken = processActivityOf([tool('bash', { running: true, args: '{oops' })]);
    expect(liveTitleOf(broken, true)).toBe('正在运行命令 · bash');
  });
});
