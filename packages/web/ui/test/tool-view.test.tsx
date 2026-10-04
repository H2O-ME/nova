/**
 * A server-render smoke pass over the ported row: no DOM, no browser —
 * `renderToStaticMarkup` walks the real JSX with real props, which is what
 * catches a slot read off a shell the test never exercises (the pure lane in
 * `tool-model.test.ts` cannot). Assertions stay at the structural level: the
 * chrome the harness defines (24px row, title/summary split, the sweep's state
 * flag) appears, and the expanded body draws its own chrome.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToolRow } from '../src/tool/ToolRow.js';
import type { ToolCallView, ToolResultView } from '../src/types.js';

function row(input: {
  name?: string;
  args?: string;
  view: ToolCallView;
  result?: ToolResultView;
  output?: string;
  tail?: string;
  idle?: boolean;
}): string {
  return renderToStaticMarkup(
    <ToolRow
      name={input.name ?? 'some_tool'}
      args={input.args ?? ''}
      view={input.view}
      result={input.result}
      output={input.output}
      tail={input.tail}
      idle={input.idle ?? false}
      anchorKey="b1"
    />,
  );
}

describe('row render', () => {
  it('draws the 24px line: title, summary and the running state flag', () => {
    const html = row({ view: { card: 'terminal', kind: 'execute', command: 'pnpm test' }, tail: 'running 3 tests' });
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
      view: { card: 'terminal', kind: 'execute', command: 'ls' },
      args: '{"command":"ls"}',
      result: { card: 'terminal', output: 'a.txt', exitCode: 0 },
    });
    expect(html).toContain('data-state="ok"');
    expect(html).toContain('退出码 0');
  });

  it('draws a diff row with its totals as the trailer', () => {
    const html = row({
      name: 'edit_file',
      view: { card: 'diff', kind: 'edit', diffs: [{ path: 'a.ts', oldText: 'x', newText: 'y' }] },
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

  it('offers no second way into the call: the detail column is gone', () => {
    // The 详情 pill used to open the tool panel — a second occupant of the
    // right column that outranked the panel pages. The column belongs to the
    // panel alone now and the expanded card body is the call's only reading,
    // so no row markup may carry the pill (or any opener) ever again.
    const expanded = row({
      view: { card: 'terminal', kind: 'execute', command: 'ls' },
      args: '{"command":"ls"}',
      result: { card: 'terminal', output: 'a.txt', exitCode: 0 },
    });
    expect(expanded).not.toContain('详情');
    expect(expanded).not.toContain('data-tool-panel');
  });
});
