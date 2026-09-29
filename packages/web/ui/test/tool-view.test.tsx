/**
 * A server-render smoke pass over the ported row and panel: no DOM, no
 * browser — `renderToStaticMarkup` walks the real JSX with real props, which is
 * what catches a slot read off a shell the test never exercises (the pure lane
 * in `tool-model.test.ts` cannot). Assertions stay at the structural level:
 * the chrome the harness defines (24px row, title/summary split, the sweep's
 * state flag, the pill) appears, and the card bodies draw their own chrome.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolPanel } from '../src/tool/ToolPanel.js';
import { ToolRow } from '../src/tool/ToolRow.js';
import type { ToolCallView, ToolResultView } from '../src/types.js';
import type { Block } from '../src/state.js';

function row(input: {
  name?: string;
  args?: string;
  view: ToolCallView;
  result?: ToolResultView;
  output?: string;
  tail?: string;
  idle?: boolean;
  selected?: boolean;
}): string {
  return renderToStaticMarkup(
    <ToolRow
      callId="c1"
      name={input.name ?? 'some_tool'}
      args={input.args ?? ''}
      view={input.view}
      result={input.result}
      output={input.output}
      tail={input.tail}
      idle={input.idle ?? false}
      selected={input.selected ?? false}
      anchorKey="b1"
      onOpen={() => undefined}
    />,
  );
}

/** The row is always collapsed on mount; open it by clicking the row element. */
function panel(block: Partial<Extract<Block, { kind: 'tool' }>> & { view: ToolCallView }, idle = false): string {
  return renderToStaticMarkup(
    <ToolPanel
      block={{
        id: 'b1',
        kind: 'tool',
        callId: 'c1',
        name: block.name ?? 'some_tool',
        args: block.args ?? '',
        view: block.view,
        ...(block.ts !== undefined ? { ts: block.ts } : {}),
        ...(block.result !== undefined ? { result: block.result } : {}),
        ...(block.output !== undefined ? { output: block.output } : {}),
      }}
      width={360}
      canShow
      idle={idle}
      onClose={() => undefined}
      onToggleFullscreen={() => undefined}
    />,
  );
}

describe('row render', () => {
  it('draws the 24px line: title, summary and the running state flag', () => {
    const html = row({ view: { card: 'terminal', command: 'pnpm test' }, tail: 'running 3 tests' });
    expect(html).toContain('data-state="running"');
    // dsh's zh dictionary (`tool.title.bash`) is the source of truth for this
    // surface's copy; the English dictionary is a translation, not the original.
    expect(html).toContain('运行命令');
    expect(html).toContain('$ pnpm test');
    expect(html).toContain('running 3 tests');
    // The collapsed row is a real disclosure control, not a div with a click.
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('运行中');
  });

  it('draws the settled exit note in the trailing slot', () => {
    const html = row({
      view: { card: 'terminal', command: 'ls' },
      args: '{"command":"ls"}',
      result: { card: 'terminal', output: 'a.txt', exitCode: 0 },
    });
    expect(html).toContain('data-state="ok"');
    expect(html).toContain('退出码 0');
  });

  it('draws a diff row with its totals as the trailer', () => {
    const html = row({
      name: 'edit_file',
      view: { card: 'diff', diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] },
      result: { card: 'diff', ok: true, diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] },
    });
    expect(html).toContain('编辑');
    expect(html).toContain('a.ts');
    expect(html).toContain('+1 -1');
  });

  it('draws the plan row from the todo card', () => {
    const html = row({
      name: 'todo_write',
      view: { card: 'generic', kind: 'plan', title: 'todos' },
      result: {
        card: 'plan',
        items: [
          { text: '第一项', status: 'completed' },
          { text: '第二项', status: 'in_progress' },
          { text: '第三项', status: 'in_progress' },
        ],
      },
    });
    expect(html).toContain('更新任务清单');
    expect(html).toContain('1/3 已完成 · 第二项');
    expect(html).toContain('+1');
  });
});

describe('panel render', () => {
  it('draws the shell, the call identity and the raw sections', () => {
    const html = panel({
      name: 'read_file',
      args: '{"path":"src/a.ts"}',
      view: { card: 'generic', kind: 'read', title: 'src/a.ts' },
      result: { card: 'read', path: 'src/a.ts', lineCount: 2, truncated: false },
      output: 'const a = 1\nconst b = 2',
      ts: Date.UTC(2026, 8, 20, 15, 46),
    });
    expect(html).toContain('data-tool-panel="push"');
    expect(html).toContain('read_file');
    expect(html).toContain('参数');
    expect(html).toContain('结果');
    expect(html).toContain('已完成');
    // The structured card is drawn whole, above the raw text: numbered lines here.
    expect(html).toContain('const a = 1');
    expect(html).toContain('全屏');
  });

  it('draws each structured card through the panel (uncapped)', () => {
    const read = panel({
      name: 'read_file',
      args: '{"path":"src/a.ts"}',
      view: { card: 'generic', kind: 'read', title: 'src/a.ts' },
      result: { card: 'read', path: 'src/a.ts', lineCount: 2, truncated: true },
      output: '[lines 5-6 of 40]\nconst a = 1\nconst b = 2',
    });
    const terminal = panel({
      name: 'bash',
      args: '{"command":"ls -la"}',
      view: { card: 'terminal', command: 'ls -la' },
      result: { card: 'terminal', output: 'a.txt\nb.txt', exitCode: 2 },
    });
    const search = panel({
      name: 'search_files',
      args: '{"content_regex":"TODO"}',
      view: { card: 'search', query: 'TODO', mode: 'content' },
      result: { card: 'search', matches: [{ path: 'a.ts', line: 3 }], truncated: false },
      output: 'a.ts:3: // TODO one',
    });
    const plan = panel({
      name: 'todo_write',
      args: '{"todos":[]}',
      view: { card: 'generic', kind: 'plan', title: 'todos' },
      result: { card: 'plan', items: [{ text: '第一项', status: 'completed' }] },
    });
    const io = panel({
      name: 'get_time',
      args: '{"zone":"utc"}',
      view: { card: 'generic', kind: 'other', title: 'utc' },
      result: { card: 'generic', ok: true, text: '2026-09-23T00:00:00Z' },
      output: '2026-09-23T00:00:00Z',
    });
    // Read: numbered window, the tool's own offset and the window note.
    expect(read).toContain('显示 2 / 40 行');
    expect(read).toContain('const b = 2');
    // Terminal: prompt banner, the output, and the non-zero exit pill.
    expect(terminal).toContain('ls -la');
    expect(terminal).toContain('b.txt');
    expect(terminal).toContain('退出码 2');
    // Search: grouped banner and the match line with its number.
    expect(search).toContain('1 处匹配 · 1 个文件');
    expect(search).toContain('// TODO one');
    // Plan: the counts banner.
    expect(plan).toContain('1/1 已完成');
    expect(plan).toContain('第一项');
    // Generic: no card of its own, so the panel's raw sections are the body.
    expect(io).toContain('参数');
    expect(io).toContain('结果');
    expect(io).toContain('2026-09-23T00:00:00Z');
  });

  it('says a result-less call is running while the turn is live, stopped once it is idle', () => {
    // The panel used to hardcode `idle: true`, so an open details board called
    // every in-flight call "已停止" while the row behind it said "运行中".
    const live = panel({ name: 'bash', args: '{"command":"pnpm test"}', view: { card: 'generic', kind: 'execute', title: 'pnpm test' } });
    expect(live).toContain('运行中');
    expect(live).not.toContain('已停止');
    const stopped = panel(
      { name: 'bash', args: '{"command":"pnpm test"}', view: { card: 'generic', kind: 'execute', title: 'pnpm test' } },
      true,
    );
    expect(stopped).toContain('已停止');
  });

  it('takes the frame when the column has no track, and fills it in fullscreen', () => {
    const takeover = renderToStaticMarkup(
      <ToolPanel
        block={{ id: 'b1', kind: 'tool', callId: 'c1', name: 'x', args: '', view: { card: 'generic', kind: 'other', title: 'x' } }}
        width={0}
        canShow={false}
        idle={false}
        fullscreen={false}
        onClose={() => undefined}
        onToggleFullscreen={() => undefined}
      />,
    );
    const fullscreen = renderToStaticMarkup(
      <ToolPanel
        block={{ id: 'b1', kind: 'tool', callId: 'c1', name: 'x', args: '', view: { card: 'generic', kind: 'other', title: 'x' } }}
        width={0}
        canShow={false}
        idle={false}
        fullscreen
        onClose={() => undefined}
        onToggleFullscreen={() => undefined}
      />,
    );
    expect(takeover).toContain('data-tool-panel="takeover"');
    expect(fullscreen).toContain('data-tool-panel="fullscreen"');
    expect(fullscreen).toContain('退出全屏');
  });
});