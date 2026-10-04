/**
 * The tool card's decision layer, pinned without a DOM (M11 批3): the six cards
 * of the presentation vocabulary go in, a render model comes out. These are the
 * assertions that the *surface* half of the contract holds — a card this bundle
 * has never seen still renders, failure is read from the card that owns it, and
 * a call still in flight is never mistaken for a leftover.
 */
import { describe, expect, it } from 'vitest';
import { toolCardModel } from '../src/card-view.js';
import type { CardInput } from '../src/card-view.js';

function model(input: Partial<CardInput> & Pick<CardInput, 'view'>): ReturnType<typeof toolCardModel> {
  return toolCardModel({ name: 'some_tool', args: '', result: undefined, idle: false, ...input });
}

describe('call state', () => {
  it('a call with no result is running; the same call idle is stale', () => {
    const view = { card: 'terminal' as const, kind: 'execute' as const, command: 'ls' };
    expect(model({ view }).state).toBe('running');
    expect(model({ view, idle: true }).state).toBe('stale');
  });

  it('a call with a result is never running, whatever idle says', () => {
    const view = { card: 'generic' as const, kind: 'other' as const, title: 'x' };
    const result = { card: 'generic' as const, ok: true, text: 'done' };
    expect(model({ view, result, idle: false }).state).toBe('ok');
    expect(model({ view, result, idle: true }).state).toBe('ok');
  });

  it('without a result the args are the body, flattened to one line', () => {
    const body = model({ view: { card: 'terminal', kind: 'execute', command: 'ls' }, args: '{\n  "command": "ls"\n}' }).body;
    expect(body).toEqual({ kind: 'args', text: '{ "command": "ls" }' });
  });
});

describe('terminal card', () => {
  const call = { card: 'terminal' as const, kind: 'execute' as const, command: 'pnpm test' };

  it('headline is the command, monospace', () => {
    const m = model({ view: call });
    expect(m.headline).toBe('$ pnpm test');
    expect(m.mono).toBe(true);
  });

  it('exit 0 is ok, with a muted exit note', () => {
    const m = model({ view: call, result: { card: 'terminal', output: 'ok', exitCode: 0 } });
    expect(m.state).toBe('ok');
    expect(m.body).toEqual({ kind: 'output', text: 'ok' });
    expect(m.foot).toBe('退出码 0');
    expect(m.footTone).toBe('muted');
  });

  it('a nonzero exit fails and says so in the footnote tone', () => {
    const m = model({ view: call, result: { card: 'terminal', output: 'boom', exitCode: 2 } });
    expect(m.state).toBe('fail');
    expect(m.foot).toBe('退出码 2');
    expect(m.footTone).toBe('fail');
  });

  it('a process that never exited says so instead of inventing a code', () => {
    const m = model({ view: call, result: { card: 'terminal', output: '', exitCode: null } });
    expect(m.foot).toBe('未退出（中断/超时）');
    expect(m.body).toEqual({ kind: 'output', text: '' });
  });

  it('dropped bytes are reported alongside the exit code, humanized', () => {
    const m = model({
      view: call,
      result: { card: 'terminal', output: 'head…tail', exitCode: 0, droppedBytes: 4096 },
    });
    expect(m.foot).toBe('退出码 0 · 省略 4.0 KB');
  });
});

describe('diff card', () => {
  const one = { path: 'src/a.ts', oldText: 'old', newText: 'new' };
  const two = [
    one,
    { path: 'src/b.ts', oldText: null, newText: 'brand new' },
  ];

  it('one file names the file; several count them', () => {
    expect(model({ view: { card: 'diff', kind: 'edit', diffs: [one] } }).headline).toBe('src/a.ts');
    expect(model({ view: { card: 'diff', kind: 'edit', diffs: two } }).headline).toBe('src/a.ts 等 2 个文件');
  });

  it('an empty diff list still has a headline', () => {
    expect(model({ view: { card: 'diff', kind: 'edit', diffs: [] } }).headline).toBe('文件改动');
  });

  it('a written diff carries the hunks; a refused one fails', () => {
    const ok = model({ view: { card: 'diff', kind: 'edit', diffs: two }, result: { card: 'diff', ok: true, diffs: two } });
    expect(ok.state).toBe('ok');
    expect(ok.body).toEqual({ kind: 'diff', diffs: two });
    expect(ok.foot).toBeUndefined();

    const denied = model({ view: { card: 'diff', kind: 'edit', diffs: [one] }, result: { card: 'diff', ok: false, diffs: [] } });
    expect(denied.state).toBe('fail');
    expect(denied.foot).toBe('改动未完成');
    expect(denied.footTone).toBe('fail');
  });
});

describe('search card', () => {
  it('the query is the headline and the mode is this surface’s word for it', () => {
    const content = model({ view: { card: 'search', kind: 'search', query: 'TODO', mode: 'content' } });
    expect(content.headline).toBe('TODO');
    expect(content.subtitle).toBe('搜索内容');
    expect(model({ view: { card: 'search', kind: 'search', query: '*.ts', mode: 'name' } }).subtitle).toBe('搜索文件名');
  });

  it('matches render as a list; a bare short list carries no footnote', () => {
    const m = model({
      view: { card: 'search', kind: 'search', query: 'TODO', mode: 'content' },
      result: { card: 'search', matches: [{ path: 'src/a.ts', line: 12 }], truncated: false },
    });
    expect(m.state).toBe('ok');
    expect(m.body).toEqual({ kind: 'matches', matches: [{ path: 'src/a.ts', line: 12 }], truncated: false });
    expect(m.foot).toBeUndefined();
  });

  it('a truncated list says more exist', () => {
    const m = model({
      view: { card: 'search', kind: 'search', query: 'TODO', mode: 'content' },
      result: { card: 'search', matches: [{ path: 'src/a.ts' }], truncated: true },
    });
    expect(m.foot).toBe('结果被截断，共 1+ 处');
    expect(m.footTone).toBe('muted');
  });

  it('no matches is a successful call, not a failure', () => {
    const m = model({
      view: { card: 'search', kind: 'search', query: 'nothing', mode: 'name' },
      result: { card: 'search', matches: [], truncated: false },
    });
    expect(m.state).toBe('ok');
    expect(m.body).toEqual({ kind: 'text', text: '无匹配' });
  });
});

describe('read card', () => {
  it('a whole file reports path and line count', () => {
    const m = model({
      view: { card: 'generic', kind: 'read', title: 'src/a.ts' },
      result: { card: 'read', path: 'src/a.ts', lineCount: 42, truncated: false },
    });
    expect(m.state).toBe('ok');
    expect(m.body).toEqual({ kind: 'read', path: 'src/a.ts', lineCount: 42, truncated: false });
    expect(m.foot).toBeUndefined();
  });

  it('a window says it is only a slice', () => {
    const m = model({
      view: { card: 'generic', kind: 'read', title: 'src/a.ts' },
      result: { card: 'read', path: 'src/a.ts', lineCount: 200, truncated: true },
    });
    expect(m.foot).toBe('仅返回片段');
    expect(m.footTone).toBe('muted');
  });
});

describe('plan card', () => {
  const items = [
    { text: '调查', status: 'completed' },
    { text: '实现', status: 'in_progress' },
    { text: '测试', status: 'pending' },
  ];

  it('a plan with work still open is still a successful call', () => {
    const m = model({
      view: { card: 'generic', kind: 'plan', title: '3 项' },
      result: { card: 'plan', items },
    });
    expect(m.state).toBe('ok');
    expect(m.body).toEqual({ kind: 'plan', items });
    expect(m.foot).toBeUndefined();
  });
});

describe('generic card', () => {
  it('a declared subtitle wins; otherwise the kind is spelled out', () => {
    const view = { card: 'generic' as const, kind: 'read' as const, title: 'src/a.ts', subtitle: '第 10-20 行' };
    expect(model({ view }).subtitle).toBe('第 10-20 行');
    const bare = { card: 'generic' as const, kind: 'edit' as const, title: 'src/a.ts' };
    expect(model({ view: bare, name: 'edit_file' }).subtitle).toBe('编辑 edit_file');
  });

  it('an unknown kind and an unknown tool both fall back to the name', () => {
    const view = { card: 'generic' as const, kind: 'other' as const, title: 'whatever' };
    const m = model({ view, name: 'third_party_tool' });
    expect(m.headline).toBe('whatever');
    expect(m.subtitle).toBe('third_party_tool');
  });

  it('a failed generic result is a failure with a footnote', () => {
    const m = model({
      view: { card: 'generic', kind: 'other', title: 'x' },
      result: { card: 'generic', ok: false, text: 'Error: nope' },
    });
    expect(m.state).toBe('fail');
    expect(m.body).toEqual({ kind: 'text', text: 'Error: nope' });
    expect(m.foot).toBe('失败');
    expect(m.footTone).toBe('fail');
  });

  it('a successful generic result has no footnote', () => {
    const m = model({
      view: { card: 'generic', kind: 'other', title: 'x' },
      result: { card: 'generic', ok: true, text: 'fine' },
    });
    expect(m.state).toBe('ok');
    expect(m.foot).toBeUndefined();
    expect(m.footTone).toBeUndefined();
  });
});
