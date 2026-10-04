/**
 * The process group's words (`process-summary.ts`): the classification map,
 * the closed title's composition (ranked top-3, 并/，等, the shared 已 prefix),
 * and the live title's detail extraction. The harness ports these rules
 * verbatim; this file is where a vocabulary drift goes red.
 *
 * Classification is read off the call's HOST-RESOLVED view (`view.kind`, core's
 * `ToolCallKind`), never off the tool's name. The fixtures therefore build a
 * view, and the last case in the first block proves the name is not consulted —
 * a name the old name-matching implementation knew, carrying a kind it would
 * have contradicted, must follow the KIND.
 */
import { describe, expect, it } from 'vitest';
import type { ToolCallKind } from '@nova-agent/core';
import {
  liveTitleOf,
  processActivityOf,
  processTitle,
  type ProcessSpanBlock,
} from '../src/chat/process-summary.js';

const tool = (kind: ToolCallKind, name: string, over: Partial<ProcessSpanBlock> = {}): ProcessSpanBlock =>
  ({ kind: 'tool', name, view: { card: 'generic', kind, title: name }, ...over });

describe('processActivityOf', () => {
  it('counts one entry per declared call kind, and an unclassified call as 已调用工具', () => {
    const summary = processActivityOf([
      tool('read', 'read_file'),
      tool('search', 'search_files'),
      tool('write', 'write_file'),
      tool('edit', 'edit_file'),
      tool('execute', 'bash'),
      tool('execute', 'run_code'),
      tool('job', 'jobs'),
      tool('subagents', 'subagent'),
      tool('plan', 'todo_write'),
      tool('question', 'ask_user_question'),
      tool('other', 'switch_workspace'),
      tool('other', 'mystery_tool'),
    ]);
    expect(Object.fromEntries(summary.counts.map(({ kind, count }) => [kind, count]))).toEqual({
      read: 1,
      search: 1,
      write: 1,
      edit: 1,
      execute: 2,
      job: 1,
      subagents: 1,
      plan: 1,
      question: 1,
      other: 2,
    });
  });

  it('follows the declared kind, not the tool name', () => {
    // The same NAME in two categories: the classification cannot come from it.
    const summary = processActivityOf([
      tool('read', 'some-plugin-tool'),
      tool('execute', 'some-plugin-tool'),
    ]);
    expect(summary.counts.map(({ kind, count }) => [kind, count])).toEqual([['read', 1], ['execute', 1]]);

    // …and a built-in's own name does not override the view it declared.
    const overridden = processActivityOf([tool('subagents', 'bash')]);
    expect(overridden.counts.map(({ kind }) => kind)).toEqual(['subagents']);
  });

  it('falls back to the generic category for a block with no resolved view', () => {
    // A frame the host could not resolve (or an older one): no view at all.
    const summary = processActivityOf([{ kind: 'tool', name: 'read_file' }]);
    expect(summary.counts.map(({ kind }) => kind)).toEqual(['other']);
  });

  it('ranks count-descending and breaks ties by first appearance', () => {
    const summary = processActivityOf([
      tool('execute', 'bash'),
      tool('read', 'read_file'),
      tool('execute', 'bash'),
      tool('search', 'search_files'),
      tool('read', 'read_file'),
    ]);
    // bash and read tie at 2 — bash appeared first; search (1) trails.
    expect(summary.counts.map(({ kind }) => kind)).toEqual(['execute', 'read', 'search']);
    expect(summary.counts.map(({ count }) => count)).toEqual([2, 2, 1]);
  });

  it('reports the in-flight call as running with its first meaningful arg', () => {
    const summary = processActivityOf([
      tool('read', 'read_file', { running: false }),
      tool('execute', 'bash', { running: true, args: '{"command":"git status"}' }),
    ]);
    expect(summary.running).toBe('execute');
    expect(summary.runningDetail).toBe('git status');
  });

  it('with no running call the live detail falls back to the newest finished thought', () => {
    const summary = processActivityOf([
      tool('read', 'read_file'),
      { kind: 'reasoning', text: '第一段\n\n**第二段**' },
    ]);
    expect(summary.running).toBeUndefined();
    expect(summary.runningDetail).toBe('第二段');
  });

  it('ignores non-tool and reasoning blocks when counting', () => {
    const summary = processActivityOf([
      { kind: 'text', text: '正文' },
      { kind: 'reasoning', text: '想' },
      tool('read', 'read_file'),
    ]);
    expect(summary.counts.map(({ kind }) => kind)).toEqual(['read']);
    expect(summary.running).toBeUndefined();
  });
});

describe('processTitle', () => {
  it('names one category alone, two with 并, three with commas', () => {
    expect(processTitle(processActivityOf([tool('read', 'read_file')]))).toBe('已读取文件');
    expect(processTitle(processActivityOf([tool('read', 'read_file'), tool('execute', 'bash')])))
      .toBe('已读取文件并执行了命令');
    const three = processActivityOf([tool('read', 'read_file'), tool('execute', 'bash'), tool('search', 'search_files')]);
    expect(processTitle(three)).toBe('已读取文件，执行了命令，已搜索代码');
  });

  it('drops the shared 已 prefix from the second label only when both carry it', () => {
    const both = processActivityOf([tool('read', 'read_file'), tool('search', 'search_files')]);
    expect(processTitle(both)).toBe('已读取文件并搜索代码');
    // 修改了文件 does not carry the prefix, so the second keeps its 已.
    const mixed = processActivityOf([tool('edit', 'edit_file'), tool('write', 'write_file')]);
    expect(processTitle(mixed)).toBe('修改了文件并已写入文件');
  });

  it('closes with 等 only past three categories and falls back to 已完成分析', () => {
    const four = processActivityOf([
      tool('read', 'read_file'),
      tool('execute', 'bash'),
      tool('search', 'search_files'),
      tool('write', 'write_file'),
    ]);
    expect(processTitle(four)).toBe('已读取文件，执行了命令，已搜索代码等');
    expect(processTitle(processActivityOf([]))).toBe('已完成分析');
  });

  it('keeps the ranking through the title (a count-heavy category leads)', () => {
    const heavy = processActivityOf([tool('execute', 'bash'), tool('read', 'read_file'), tool('execute', 'bash')]);
    expect(processTitle(heavy)).toBe('执行了命令并已读取文件');
  });
});

describe('liveTitleOf', () => {
  it('names the running activity with its detail only when the policy shows it', () => {
    const running = processActivityOf([tool('execute', 'bash', { running: true, args: '{"command":"pnpm test"}' })]);
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
    // `description` outranks `command` in the priority list — a generic walk, so
    // it holds for any tool's args, not just the one that owns `command`.
    const both = processActivityOf([
      tool('execute', 'bash', { running: true, args: '{"command":"x","description":"装依赖"}' }),
    ]);
    expect(liveTitleOf(both, true)).toBe('正在运行命令 · 装依赖');
    // A 200-code-point command is cut to 160 with an ellipsis (159 + …).
    const long = 'a'.repeat(200);
    const capped = processActivityOf([tool('execute', 'bash', { running: true, args: `{"command":"${long}"}` })]);
    const detail = liveTitleOf(capped, true).replace('正在运行命令 · ', '');
    expect(Array.from(detail)).toHaveLength(160);
    expect(detail.endsWith('…')).toBe(true);
  });

  it('survives malformed args by falling back to the tool name', () => {
    const broken = processActivityOf([tool('execute', 'bash', { running: true, args: '{oops' })]);
    expect(liveTitleOf(broken, true)).toBe('正在运行命令 · bash');
  });
});
