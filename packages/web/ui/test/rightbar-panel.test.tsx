/**
 * The right panel's rendered shell (`rightbar/RightbarPanel.tsx`), asserted as
 * markup (this lane has no DOM).
 *
 * Two things are contracts rather than looks:
 *
 *  - **The strip is the panel's whole top edge**, and every page it offers has a
 *    named tab. The harness draws no title row (its controls ride the tab strip),
 *    and a page reachable only by a keyboard shortcut would be unreachable here.
 *  - **The panel states its own presentation** (`data-rightbar`): with a track it
 *    is a column that pushes the centre, without one it takes the frame. The
 *    frame reads that attribute's vocabulary from `layout-store`, so the two
 *    cannot drift into "I thought I had a track".
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RightbarPanel } from '../src/rightbar/RightbarPanel.js';
import { emptyChanges, changesModel } from '../src/rightbar/changes-model.js';
import { emptyTree } from '../src/rightbar/files-model.js';
import { emptyTerminal, upsertTerminal } from '../src/rightbar/terminal-model.js';
import { RIGHTBAR_COPY } from '../src/rightbar/copy.js';
import type { ClientFrame } from '../src/types.js';
import type { RightbarTabId } from '../src/rightbar/tabs.js';

const send = (_frame: ClientFrame): void => {};

function html(tab: RightbarTabId, over: Partial<Parameters<typeof RightbarPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    <RightbarPanel
      width={360}
      canShow
      fullscreen={false}
      onToggleFullscreen={() => {}}
      onClose={() => {}}
      tab={tab}
      changes={emptyChanges}
      tree={emptyTree}
      terminal={emptyTerminal}
      sessions={null}
      currentFile=""
      rootDir=""
      connected
      send={send}
      {...over}
    />,
  );
}

/** The `role="tab"` labels the strip drew, in order. */
function tabLabels(markup: string): string[] {
  return [...markup.matchAll(/role="tab"[^>]*>([^<]*)</g)].map((match) => match[1] ?? '');
}

describe('right panel shell', () => {
  it('draws every page as a named tab, with the active one selected', () => {
    const markup = html('terminal');
    expect(tabLabels(markup)).toEqual(['变更', '文件', '终端']);
    expect(markup).toContain(RIGHTBAR_COPY['panel.label']);
    const selected = markup.match(/aria-selected="true"[^>]*>([^<]*)</)?.[1];
    expect(selected).toBe('终端');
  });

  it('states its presentation for the frame', () => {
    expect(html('changes')).toContain('data-rightbar="push"');
    // No track: the panel covers the frame rather than leaving an unreadable
    // sliver of transcript beside it.
    expect(html('changes', { canShow: false })).toContain('data-rightbar="takeover"');
    expect(html('changes', { fullscreen: true })).toContain('data-rightbar="fullscreen"');
  });

  it('tells the reader where the diffs come from when there are none', () => {
    // The tab is not `git status`: saying so is what keeps its silence from
    // being read as "the session changed nothing".
    const markup = html('changes');
    expect(markup).toContain(RIGHTBAR_COPY['changes.empty']);
    expect(markup).toContain(RIGHTBAR_COPY['changes.empty.note']);
  });

  it('renders the changed files with their counts once there are any', () => {
    const changes = changesModel([
      {
        id: 'b1',
        kind: 'tool',
        callId: 'c1',
        name: 'edit_file',
        args: '{}',
        view: { card: 'diff', diffs: [{ path: 'src/a.ts', oldText: 'a\n', newText: 'a\nb\n' }] },
      },
    ]);
    const markup = html('changes', { changes });
    expect(markup).toContain('src/a.ts');
    expect(markup).toContain('+1 −0');
    expect(markup).toContain(RIGHTBAR_COPY['changes.list.label']);
  });

  it('says the terminal is not interactive, before the reader types', () => {
    const markup = html('terminal');
    expect(markup).toContain(RIGHTBAR_COPY['terminal.input.placeholder']);
    expect(markup).toContain(RIGHTBAR_COPY['terminal.empty.note']);
  });

  it('shows a finished command’s output and status', () => {
    const terminal = upsertTerminal(
      upsertTerminal(emptyTerminal, { id: 'bash-1', command: 'pnpm test', status: 'running', text: 'running…\n' }),
      { id: 'bash-1', command: 'pnpm test', status: 'completed', detail: 'exit code: 0', text: 'ok\n' },
    );
    const markup = html('terminal', { terminal });
    expect(markup).toContain('pnpm test');
    expect(markup).toContain(RIGHTBAR_COPY['terminal.completed']);
    expect(markup).toContain('running…');
    expect(markup).toContain('ok');
  });

  it('renders the workspace tree and the session logs in the 文件 tab', () => {
    const markup = html('files', {
      rootDir: '/w',
      tree: { levels: { '/w': { status: 'ready', entries: [{ name: 'src', path: '/w/src', hidden: false, kind: 'dir' }], truncated: false } }, asking: [] },
      sessions: [{ file: '/n/one.jsonl', title: '改侧边栏', mtime: 1_000, workspace: '/w' }],
      currentFile: '/n/one.jsonl',
    });
    expect(markup).toContain('/w');
    expect(markup).toContain('src');
    expect(markup).toContain(RIGHTBAR_COPY['files.sessions']);
    expect(markup).toContain('改侧边栏');
    expect(markup).toContain(RIGHTBAR_COPY['files.sessions.current']);
  });
});
