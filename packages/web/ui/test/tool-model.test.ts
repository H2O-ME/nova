/**
 * The tool row's decision layer, pinned without a DOM: the card render model of
 * `card-view.ts` plus a `ToolCallView`/`ToolResultView` pair go in, the row's
 * slots and the expanded body's shape come out. These are the assertions that
 * the *ported* half of the row holds — the harness's title/summary/suffix
 * mapping, the plan row's summary split, the IN/OUT fallback, the read window
 * and the collapse arithmetic.
 */
import { describe, expect, it } from 'vitest';
import { toolCardModel } from '../src/card-view.js';
import type { CardInput } from '../src/card-view.js';
import {
  diffCopyText,
  diffFiles,
  diffTotals,
  foldLabels,
  headTailCap,
  matchTexts,
  planSummary,
  promptLabel,
  readWindow,
  readWindowNote,
  searchCopyText,
  searchGroups,
  searchSummary,
} from '../src/tool/cards.js';
import {
  bodyShell,
  formatToolBody,
  rowDot,
  rowSlots,
  rowStatusLabel,
  rowVariant,
  terminalDot,
  type ShellInput,
} from '../src/tool/model.js';

function model(input: Partial<CardInput> & Pick<CardInput, 'view'>): ReturnType<typeof toolCardModel> {
  return toolCardModel({ name: 'some_tool', args: '', result: undefined, idle: false, ...input });
}

function shell(input: Partial<ShellInput> & Pick<ShellInput, 'view'>): ReturnType<typeof bodyShell> {
  const card = model(input);
  return bodyShell({
    view: input.view,
    body: input.body ?? card.body,
    result: input.result,
    model: card,
    output: input.output,
    tail: input.tail,
    args: input.args ?? '',
  });
}

function slots(input: Partial<CardInput> & Pick<CardInput, 'view'>): ReturnType<typeof rowSlots> {
  const card = model(input);
  return rowSlots({ name: input.name ?? 'some_tool', view: input.view, model: card });
}

describe('row slots', () => {
  it('a shell call: Bash title, the command as a mono summary, the exit note trailing', () => {
    const view = { card: 'terminal' as const, command: 'pnpm test' };
    const row = slots({ view, args: '{"command":"pnpm test"}', result: { card: 'terminal', output: 'ok', exitCode: 0 } });
    expect(row.title).toBe('Bash');
    expect(row.summary).toBe('$ pnpm test');
    expect(row.mono).toBe(true);
    expect(row.suffix).toBe('退出码 0');
    expect(row.suffixTone).toBe('muted');
  });

  it('a read call takes the read title and the operand as its summary', () => {
    const view = { card: 'generic' as const, kind: 'read' as const, title: 'src/a.ts' };
    const row = slots({ view, result: { card: 'read', path: 'src/a.ts', lineCount: 10, truncated: false } });
    expect(row.title).toBe('读取');
    expect(row.summary).toBe('src/a.ts');
    expect(row.mono).toBe(false);
  });

  it('a write call is 写入, an edit call is 编辑 (the result card decides)', () => {
    const created = { card: 'generic' as const, kind: 'write' as const, title: 'a.ts' };
    const edited = { card: 'generic' as const, kind: 'edit' as const, title: 'a.ts' };
    const write = slots({ view: created, result: { card: 'diff', ok: true, diffs: [{ path: 'a.ts', oldText: null, newText: 'x' }] } });
    const edit = slots({
      view: edited,
      result: { card: 'diff', ok: true, diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] },
    });
    expect(write.title).toBe('写入');
    expect(edit.title).toBe('编辑');
  });

  it('a successful diff trails its +/- totals in the diff tone', () => {
    const view = { card: 'generic' as const, kind: 'edit' as const, title: 'a.ts' };
    const row = slots({
      view,
      result: { card: 'diff', ok: true, diffs: [{ path: 'a.ts', oldText: 'a\nb', newText: 'a\nc\nd' }] },
    });
    expect(row.suffix).toBe('+2 -1');
    expect(row.suffixTone).toBe('diff');
  });

  it('a failed diff drops the totals for the failure line', () => {
    const view = { card: 'generic' as const, kind: 'edit' as const, title: 'a.ts' };
    const row = slots({
      view,
      result: { card: 'diff', ok: false, diffs: [{ path: 'a.ts', oldText: 'a', newText: 'b' }] },
    });
    expect(row.suffix).toBe('改动未完成');
    expect(row.suffixTone).toBe('fail');
  });

  it('a plan row counts its items and keeps the parallel-active count out of the ellipsis', () => {
    const view = { card: 'generic' as const, kind: 'plan' as const, title: 'todos' };
    const row = slots({
      view,
      result: {
        card: 'plan',
        items: [
          { text: '一', status: 'completed' },
          { text: '二', status: 'in_progress' },
          { text: '三', status: 'in_progress' },
          { text: '四', status: 'pending' },
        ],
      },
    });
    expect(row.title).toBe('更新任务清单');
    expect(row.summary).toBe('1/4 已完成 · 二');
    expect(row.suffix).toBe('+1');
    expect(row.suffixTone).toBe('muted');
  });

  it('an unnamed plan still reports its counts', () => {
    const view = { card: 'generic' as const, kind: 'plan' as const, title: 'todos' };
    const row = slots({ view, result: { card: 'plan', items: [{ text: '  ', status: 'in_progress' }] } });
    expect(row.summary).toBe('0/1 已完成');
    expect(row.suffix).toBeNull();
  });

  it('an unclassified tool keeps its name in the summary slot', () => {
    const view = { card: 'generic' as const, kind: 'other' as const, title: 'do the thing' };
    const row = slots({ name: 'subagent', view, result: { card: 'generic', ok: true, text: 'done' } });
    expect(row.title).toBe('工具调用');
    expect(row.summary).toBe('subagent · do the thing');
    expect(row.suffix).toBeNull();
  });

  it('a failed generic call takes the error tone', () => {
    const view = { card: 'generic' as const, kind: 'other' as const, title: 'x' };
    const row = slots({ view, result: { card: 'generic', ok: false, text: 'boom' } });
    expect(row.suffix).toBe('失败');
    expect(row.suffixTone).toBe('fail');
  });

  it('a search call titles itself by mode and trails the mode word', () => {
    const content = slots({ view: { card: 'search', query: 'TODO', mode: 'content' } });
    const name = slots({ view: { card: 'search', query: '**/*.ts', mode: 'name' } });
    expect(content.title).toBe('搜索');
    expect(content.summary).toBe('TODO');
    expect(content.mono).toBe(true);
    expect(content.suffix).toBe('搜索内容');
    expect(name.suffix).toBe('搜索文件名');
  });
});

describe('row variant and state marks', () => {
  it('the variant follows the card, not the tool name', () => {
    expect(rowVariant({ card: 'terminal', command: 'ls' }, { kind: 'args', text: '{}' })).toBe('bash');
    expect(rowVariant({ card: 'generic', kind: 'read', title: 'a' }, { kind: 'none' })).toBe('others');
    expect(rowVariant({ card: 'generic', kind: 'read', title: 'a' }, { kind: 'read', path: 'a', lineCount: 1, truncated: false })).toBe(
      'read',
    );
  });

  it('only the signal-bearing states take the leading box; ok keeps the glyph', () => {
    expect(rowDot('running')).toBe('ongoing');
    expect(rowDot('stale')).toBe('idle');
    expect(rowDot('fail')).toBe('error');
    expect(rowDot('ok')).toBeNull();
  });

  it('the run-state label is announced for every state but ok', () => {
    expect(rowStatusLabel('running')).toBe('运行中');
    expect(rowStatusLabel('fail')).toBe('失败');
    expect(rowStatusLabel('stale')).toBe('已停止');
    expect(rowStatusLabel('ok')).toBeNull();
  });

  it('the terminal dot reads in-flight, clean and failed', () => {
    expect(terminalDot({ card: 'terminal', command: 'ls', output: '', exitCode: undefined, running: true, pill: null })).toBe('ongoing');
    expect(terminalDot({ card: 'terminal', command: 'ls', output: '', exitCode: 0, running: false, pill: null })).toBe('done');
    expect(terminalDot({ card: 'terminal', command: 'ls', output: '', exitCode: null, running: false, pill: '失败' })).toBe('error');
  });
});

describe('expanded body', () => {
  it('a terminal result draws the banner with its command, output and pill', () => {
    const body = shell({
      view: { card: 'terminal', command: 'ls -la' },
      args: '{"command":"ls -la"}',
      result: { card: 'terminal', output: 'a\nb\n', exitCode: 2 },
    });
    expect(body).toMatchObject({ card: 'terminal', command: 'ls -la', output: 'a\nb\n', exitCode: 2, pill: '退出码 2' });
  });

  it('a clean exit draws no pill; a never-exited process keeps the failure line', () => {
    const clean = shell({
      view: { card: 'terminal', command: 'ls' },
      result: { card: 'terminal', output: 'ok', exitCode: 0 },
    });
    const killed = shell({
      view: { card: 'terminal', command: 'sleep 9' },
      result: { card: 'terminal', output: '', exitCode: null },
    });
    expect(clean).toMatchObject({ card: 'terminal', pill: null });
    expect(killed).toMatchObject({ card: 'terminal', exitCode: null, pill: '未退出（中断/超时）' });
  });

  it('a running shell call keeps the banner and carries the live tail', () => {
    const body = shell({ view: { card: 'terminal', command: 'pnpm test' }, tail: 'running 3 tests' });
    expect(body).toMatchObject({ card: 'terminal', running: true, exitCode: undefined, output: 'running 3 tests', pill: null });
  });

  it('a read result is a numbered window off the tool’s own header', () => {
    const body = shell({
      view: { card: 'generic', kind: 'read', title: 'a.ts' },
      result: { card: 'read', path: 'a.ts', lineCount: 2, truncated: true },
      output: '[lines 5-6 of 40]\nfoo\nbar',
    });
    expect(body).toMatchObject({ card: 'read', path: 'a.ts', truncated: true });
    if (body.card !== 'read') throw new Error('expected a read shell');
    expect(body.window).toEqual({ offset: 5, total: 40, lines: ['foo', 'bar'] });
    expect(readWindowNote(body.window, true)).toBe('显示 2 / 40 行');
  });

  it('a search result groups by file and looks its match texts up from the result text', () => {
    const body = shell({
      view: { card: 'search', query: 'TODO', mode: 'content' },
      result: {
        card: 'search',
        matches: [
          { path: 'a.ts', line: 3 },
          { path: 'a.ts', line: 9 },
          { path: 'b.ts', line: 1 },
        ],
        truncated: false,
      },
      output: 'a.ts:3: // TODO one\na.ts:9: // TODO two\nb.ts:1: // TODO three',
    });
    expect(body).toMatchObject({ card: 'search', mode: 'content', shown: 3, total: 3, truncated: false });
    if (body.card !== 'search') throw new Error('expected a search shell');
    expect(body.groups).toEqual([
      { path: 'a.ts', lines: [3, 9] },
      { path: 'b.ts', lines: [1] },
    ]);
    expect(body.texts.get('a.ts:9')).toBe('// TODO two');
    expect(searchSummary({ mode: 'content', shown: 3, total: 3, files: 2, truncated: false })).toBe('3 处匹配 · 2 个文件');
  });

  it('a capped search says so without inventing a pre-cap total', () => {
    const body = shell({
      view: { card: 'search', query: 'x', mode: 'content' },
      result: { card: 'search', matches: [{ path: 'a.ts', line: 1 }], truncated: true },
    });
    if (body.card !== 'search') throw new Error('expected a search shell');
    expect(body.total).toBeNull();
    expect(searchSummary({ mode: 'content', shown: 1, total: body.total, files: 1, truncated: true })).toBe(
      '1 处匹配 · 1 个文件（已达上限）',
    );
  });

  it('a name-mode search is a flat path list', () => {
    const body = shell({
      view: { card: 'search', query: '**/*.ts', mode: 'name' },
      result: { card: 'search', matches: [{ path: 'a.ts' }, { path: 'b.ts' }], truncated: false },
      output: 'a.ts\nb.ts',
    });
    if (body.card !== 'search') throw new Error('expected a search shell');
    expect(body.mode).toBe('name');
    expect(body.texts.size).toBe(0);
    expect(searchSummary({ mode: 'name', shown: 2, total: 2, files: 2, truncated: false })).toBe('2 个路径');
  });

  it('a diff result carries interleaved rows and the totals both places print', () => {
    const body = shell({
      view: { card: 'diff', diffs: [{ path: 'a.ts', oldText: 'a\nb', newText: 'a\nc' }] },
      result: { card: 'diff', ok: true, diffs: [{ path: 'a.ts', oldText: 'a\nb', newText: 'a\nc' }] },
    });
    expect(body).toMatchObject({ card: 'diff', added: 1, removed: 1 });
    if (body.card !== 'diff') throw new Error('expected a diff shell');
    expect(body.files[0]?.rows.map((row) => row.t)).toEqual(['ctx', 'del', 'add']);
    expect(diffCopyText(body.files)).toBe('a.ts\n  a\n- b\n+ c');
  });

  it('a plan result carries its counts', () => {
    const body = shell({
      view: { card: 'generic', kind: 'plan', title: 'todos' },
      result: { card: 'plan', items: [{ text: '一', status: 'completed' }, { text: '二', status: 'pending' }] },
    });
    expect(body).toMatchObject({ card: 'plan', done: 1, total: 2, active: 0 });
  });

  it('a card-less call falls back to the IN/OUT pair', () => {
    const body = shell({ view: { card: 'generic', kind: 'other', title: 'x' }, args: '{"a":1}', result: { card: 'generic', ok: true, text: 'done' } });
    expect(body).toEqual({ card: 'io', input: '{\n  "a": 1\n}', output: 'done' });
  });

  it('a call in flight shows its input alone; no args and no result is no body at all', () => {
    expect(shell({ view: { card: 'generic', kind: 'other', title: 'x' }, args: '{"a":1}' })).toEqual({
      card: 'io',
      input: '{\n  "a": 1\n}',
      output: null,
    });
    expect(shell({ view: { card: 'generic', kind: 'other', title: 'x' } })).toEqual({ card: 'io', input: null, output: null });
  });

  it('an empty result text is not an OUT section', () => {
    const body = shell({ view: { card: 'generic', kind: 'other', title: 'x' }, args: '{}', result: { card: 'generic', ok: true, text: '' } });
    expect(body).toEqual({ card: 'io', input: '{}', output: null });
  });
});

describe('pure derivations', () => {
  it('formatToolBody pretty-prints JSON, keeps malformed text verbatim and drops nothing-text', () => {
    expect(formatToolBody('')).toBeNull();
    expect(formatToolBody('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(formatToolBody('{"a":')).toBe('{"a":');
    expect(formatToolBody('"raw"')).toBe('"raw"');
  });

  it('readWindow numbers from the tool’s header and treats the trailing newline as a terminator', () => {
    // No header = the whole result, and no total it could honestly print: the
    // result card's own `lineCount` is `split('\n').length`, one too many when
    // the text ends with a newline.
    expect(readWindow('a\nb\n')).toEqual({ offset: 1, total: null, lines: ['a', 'b'] });
    expect(readWindow('[lines 3-4 of 10]\nx\ny')).toEqual({ offset: 3, total: 10, lines: ['x', 'y'] });
    expect(readWindow('')).toEqual({ offset: 1, total: null, lines: [] });
  });

  it('readWindowNote prints a fraction only over a stated total, and names a cut otherwise', () => {
    const whole = readWindow('a\nb\n');
    // No header = no total, and the reader is not shown a fraction at all: the
    // old note here was `显示 2 / 3 行` for a two-line file.
    expect(whole.total).toBeNull();
    expect(readWindowNote(whole, false)).toBe('显示 2 行');
    // A capped list_dir carries a `(... N more)` marker line and no header: the
    // fraction that used to print here was `显示 501 / 500 行`.
    expect(readWindowNote(readWindow('a\nb\nc\n(... 500 more)'), true)).toBe('显示 4 行（已截断）');
    expect(readWindowNote(readWindow('[lines 3-4 of 10]\nx\ny'), true)).toBe('显示 2 / 10 行');
  });

  it('searchGroups keeps first-seen file order and drops missing line numbers', () => {
    expect(searchGroups([{ path: 'a' }, { path: 'b', line: 2 }, { path: 'a', line: 7 }])).toEqual([
      { path: 'a', lines: [7] },
      { path: 'b', lines: [2] },
    ]);
  });

  it('matchTexts reads the tool’s own path:line: text format', () => {
    const texts = matchTexts('a.ts:3: one\nnot a hit\nb.ts:12: two');
    expect(texts.get('a.ts:3')).toBe('one');
    expect(texts.get('b.ts:12')).toBe('two');
    expect(texts.size).toBe(2);
  });

  it('searchCopyText copies the whole result, whatever the card shows', () => {
    const groups = [{ path: 'a.ts', lines: [3] }, { path: 'b.ts', lines: [] }];
    expect(searchCopyText(groups, new Map([['a.ts:3', 'one']]))).toBe('a.ts\n3: one\n\nb.ts');
  });

  it('planSummary names the first active item and counts the rest', () => {
    const plan = planSummary([
      { text: '一', status: 'in_progress' },
      { text: '二', status: 'in_progress' },
      { text: '三', status: 'completed' },
    ]);
    expect(plan).toEqual({ done: 1, total: 3, activeContent: '一', activeExtra: 1, active: 2 });
  });

  it('headTailCap splits the cap in half and reports what it hides', () => {
    expect(headTailCap(20, 8, false)).toEqual({ hidden: 12, capped: true, headLines: 4, tailLines: 4 });
    expect(headTailCap(20, 8, true)).toEqual({ hidden: 12, capped: false, headLines: 4, tailLines: 4 });
    expect(headTailCap(3, 8, false)).toEqual({ hidden: -5, capped: false, headLines: 4, tailLines: 4 });
  });

  it('fold copy is the harness’s', () => {
    const labels = foldLabels('输出', '输出');
    expect(labels.expand(12)).toBe('… 其余 12 行');
    expect(labels.expandAria(12)).toBe('展开其余 12 行输出');
    expect(labels.collapse).toBe('收起');
    expect(labels.collapseAria).toBe('收起输出');
    expect(foldLabels('', '内容').expandAria(3)).toBe('展开其余 3 行');
  });

  it('a prompt label is the cwd’s last segment, or ~ at home', () => {
    expect(promptLabel('D:/web/agent', undefined)).toBe('agent');
    expect(promptLabel('/home/me/project/', '/home/me')).toBe('project');
    expect(promptLabel('/home/me', '/home/me')).toBe('~');
    expect(promptLabel('/', undefined)).toBe('/');
  });

  it('diff totals count both sides across files', () => {
    const files = diffFiles([
      { path: 'a.ts', oldText: null, newText: 'x\ny' },
      { path: 'b.ts', oldText: 'p', newText: '' },
    ]);
    expect(diffTotals([{ path: 'a.ts', oldText: null, newText: 'x\ny' }])).toEqual({ added: 2, removed: 0 });
    expect(files.map((file) => file.path)).toEqual(['a.ts', 'b.ts']);
  });
});