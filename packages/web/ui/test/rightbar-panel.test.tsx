/**
 * The right panel's rendered shell (`rightbar/RightbarPanel.tsx`), asserted as
 * markup (this lane has no DOM).
 *
 * The contracts here are the ones a rewrite can silently drop:
 *
 *  - **The strip is the panel's whole top edge** and every page has a named tab;
 *  - **the 文件 page never asks where the workspace is** — its tree's root is the
 *    session's own `rootDir`, and the regression this pins is the workspace
 *    picker that page used to open;
 *  - **the tree and the file are drawn TOGETHER** (the merged window: a click
 *    opens the file beside the tree, never on another page);
 *  - **the 终端 page is a real terminal** (an emulator host the shell feeds, a
 *    status band only when it ended, and no fake prompt of our own);
 *  - **the panel states its own presentation** (`data-rightbar`) so the frame and
 *    the panel cannot drift into "I thought I had a track".
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RightbarPanel } from '../src/rightbar/RightbarPanel.js';
import { changesModel } from '../src/rightbar/changes-model.js';
import { emptyEditor, docLoaded, openDoc } from '../src/rightbar/editor-model.js';
import { emptyTree } from '../src/rightbar/files-model.js';
import { emptyTerm } from '../src/rightbar/terminal-model.js';
import { RIGHTBAR_COPY } from '../src/rightbar/copy.js';
import type { ClientFrame } from '../src/types.js';
import { GUIDE_TAB, type StripTabId } from '../src/rightbar/tabs.js';
import type { Action, GitState } from '../src/state.js';
import type { WireJobRow } from '../src/types.js';

const send = (_frame: ClientFrame): void => {};
const dispatch = (_action: Action): void => {};
const noTabs: readonly StripTabId[] = ['changes', 'files', 'tasks', 'terminal'];

function html(tab: StripTabId, over: Partial<Parameters<typeof RightbarPanel>[0]> = {}): string {
  return renderToStaticMarkup(
    <RightbarPanel
      width={360}
      canShow
      fullscreen={false}
      onToggleFullscreen={() => {}}
      onClose={() => {}}
      tabs={noTabs}
      tab={tab}
      onPickTab={() => {}}
      onOpenPage={() => {}}
      onAddGuide={() => {}}
      onCloseTab={() => {}}
      changes={changesModel([])}
      tree={emptyTree}
      term={emptyTerm}
      shells={null}
      currentFile=""
      rootDir=""
      connected
      editor={emptyEditor()}
      git={null}
      jobs={null}
      dispatch={dispatch}
      send={send}
      {...over}
    />,
  );
}

/** A ready level for `/w` holding one directory and one file. */
const TREE = {
  levels: {
    '/w': {
      status: 'ready' as const,
      entries: [
        { name: 'src', path: '/w/src', hidden: false, kind: 'dir' as const },
        { name: 'README.md', path: '/w/README.md', hidden: false, kind: 'file' as const },
      ],
      truncated: false,
    },
  },
  asking: [],
};

/** The tab ids the strip drew, in order. */
function tabIds(markup: string): string[] {
  return [...markup.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1] ?? '');
}

describe('right panel shell', () => {
  it('draws only the OPEN tabs, with the front one selected, and `+` while no guide is open', () => {
    const markup = html('terminal', { tabs: ['files', 'terminal'] });
    expect(tabIds(markup)).toEqual(['files', 'terminal']);
    expect(markup).toContain(RIGHTBAR_COPY['panel.label']);
    const selected = markup.match(/aria-selected="true"[^>]*data-tab="([^"]+)"/)?.[1];
    expect(selected).toBe('terminal');
    // The `+` opens the start page as a tab (the reference's addTab → guide).
    expect(markup).toContain('data-add-guide');
    expect(markup).toContain(`aria-label="${RIGHTBAR_COPY['panel.closeTab']}：${RIGHTBAR_COPY['tab.terminal']}"`);
  });

  it('the start page is a TAB: a compass over entry capsules, one per pane, unclosable alone', () => {
    const markup = html(GUIDE_TAB, { tabs: [GUIDE_TAB] });
    expect(tabIds(markup)).toEqual([GUIDE_TAB]);
    expect(markup).toContain('data-rightbar-start');
    expect(markup).toContain(RIGHTBAR_COPY['tab.changes']);
    expect(markup).toContain(RIGHTBAR_COPY['start.files.note']);
    expect(markup).toContain(RIGHTBAR_COPY['start.terminal.note']);
    // One guide per pane: the `+` disappears while it is open (`canAddTab`)…
    expect(markup).not.toContain('data-add-guide');
    // …and standing alone it has no close verb (`canCloseTab`) — a strip with no
    // tabs would have nothing to draw.
    expect(markup).not.toContain(`${RIGHTBAR_COPY['panel.closeTab']}：${RIGHTBAR_COPY['tab.guide']}`);
    // With a page in front, the doorway is gone.
    expect(html('files', { tabs: ['files'] })).not.toContain('data-rightbar-start');
  });

  it('a guide beside an open page is closable, and still the only guide', () => {
    const markup = html('files', { tabs: ['files', GUIDE_TAB] });
    expect(tabIds(markup)).toEqual(['files', GUIDE_TAB]);
    expect(markup).toContain(`${RIGHTBAR_COPY['panel.closeTab']}：${RIGHTBAR_COPY['tab.guide']}`);
    expect(markup).not.toContain('data-add-guide');
  });

  it('states its presentation for the frame', () => {
    expect(html('changes')).toContain('data-rightbar="push"');
    // No track: the panel covers the frame rather than leaving an unreadable
    // sliver of transcript beside it.
    expect(html('changes', { canShow: false })).toContain('data-rightbar="takeover"');
    expect(html('changes', { fullscreen: true })).toContain('data-rightbar="fullscreen"');
  });

  it('offers both lenses, with the repo’s own on screen first', () => {
    const markup = html('changes');
    expect(markup).toContain(RIGHTBAR_COPY['changes.lens.git']);
    expect(markup).toContain(RIGHTBAR_COPY['changes.lens.session']);
    expect(markup).toContain(`aria-pressed="true">${RIGHTBAR_COPY['changes.lens.git']}`);
  });

  it('draws the repo lens alone while the repo lens is in front', () => {
    // The switch is what keeps the two answers from being read as one: the
    // session's edits must not be drawn under the git list.
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
    expect(html('changes', { changes })).not.toContain(RIGHTBAR_COPY['changes.list.label']);
    expect(html('changes', { changes, changesLens: 'session' })).toContain(RIGHTBAR_COPY['changes.list.label']);
  });

  it('names the reason the session lens is empty instead of drawing nothing', () => {
    const markup = html('changes', { changesLens: 'session' });
    expect(markup).toContain(RIGHTBAR_COPY['changes.empty']);
    expect(markup).toContain(RIGHTBAR_COPY['changes.empty.note']);
  });

  it('draws the git groups as trees with their letters and their verbs', () => {
    const git: GitState = {
      root: '/w',
      repo: true,
      branch: 'main',
      entries: [
        { path: 'src/a.ts', index: ' ', worktree: 'M' },
        { path: 'b.ts', index: 'A', worktree: ' ' },
      ],
      diff: null,
      log: [],
    };
    const markup = html('changes', { git });
    expect(markup).toContain(RIGHTBAR_COPY['git.unstagedSection']);
    expect(markup).toContain(RIGHTBAR_COPY['git.stagedSection']);
    // The compressed directory row plus both file names.
    expect(markup).toContain('src');
    expect(markup).toContain('a.ts');
    expect(markup).toContain('b.ts');
    // The letters, as badges; and the commit box's own control.
    expect(markup).toContain('>M<');
    expect(markup).toContain('>A<');
    expect(markup).toContain(RIGHTBAR_COPY['git.commit']);
    expect(markup).toContain('main');
    // The row's open verb exists when the host can open files (the reference's
    // 打开编辑器), and stays out of the markup when it cannot.
    expect(html('changes', { git, onOpenFile: () => {} })).toContain(`aria-label="${RIGHTBAR_COPY['git.openEditor']}"`);
    expect(markup).not.toContain(`aria-label="${RIGHTBAR_COPY['git.openEditor']}"`);
  });

  it('draws the setup card, not a dead notice, when the workspace is no repo', () => {
    // The reference's 源代码管理 empty state: an explanation and the two ways
    // in — open a folder that has a repo, or clone one by URL.
    const git: GitState = { root: '/w', repo: false, branch: '', entries: [], diff: null, log: [] };
    const markup = html('changes', { git, onOpenWorkspace: () => {} });
    expect(markup).toContain(RIGHTBAR_COPY['git.setup.title']);
    expect(markup).toContain(RIGHTBAR_COPY['git.setup.body']);
    expect(markup).toContain(RIGHTBAR_COPY['git.setup.open']);
    expect(markup).toContain(RIGHTBAR_COPY['git.setup.clone']);
    // The stale page's dead end is gone.
    expect(markup).not.toContain('git.notRepo');
  });

  it('stays on the repo view, without setup affordances, when there is one', () => {
    const git: GitState = { root: '/w', repo: true, branch: 'main', entries: [], diff: null, log: [] };
    const markup = html('changes', { git, onOpenWorkspace: () => {} });
    expect(markup).not.toContain(RIGHTBAR_COPY['git.setup.title']);
    expect(markup).not.toContain(RIGHTBAR_COPY['git.setup.open']);
  });

  it('renders the workspace tree and the open file side by side, never a picker', () => {
    // The whole point of the merged window: one page holds the explorer AND the
    // document pane, and the tree's root is the SESSION's workspace — the page
    // must never ask the reader where they are.
    const editor = docLoaded(openDoc(emptyEditor(), '/w/README.md'), {
      path: '/w/README.md', text: '# hi\n', bytes: 5, truncated: false, binary: false,
    });
    const markup = html('files', { rootDir: '/w', tree: TREE, editor });
    expect(markup).toContain('data-tree-dock');
    expect(markup).not.toContain('data-tree-full');
    expect(markup).toContain('src');
    expect(markup).toContain('# hi');
    // No picker affordance of any kind: the old page opened the workspace
    // browser on mount (「文件页面居然需要我再选择一遍」).
    expect(markup).not.toContain(RIGHTBAR_COPY['files.noWorkspace']);
    expect(markup).not.toContain('directory-browser');
  });

  it('gives the tree the whole page while nothing is open', () => {
    // The docked-strip-plus-placeholder layout read as a wasted white half
    // (「左边这一大块白色空着」); the reference's path-less home tab is the
    // standalone explorer, and the empty-editor hint left with it.
    const markup = html('files', { rootDir: '/w', tree: TREE });
    expect(markup).toContain('data-tree-full');
    expect(markup).toContain('README.md');
    expect(markup).not.toContain('还没有打开文件');
  });

  it('draws each tree row as one surface with its verbs AFTER the name', () => {
    // The clipping bug (「这里被遮挡」): verbs beside the name steal
    // its width at a narrow dock. The reference's row is one button and the
    // verbs trail the name (revealed by CSS on hover), never precede it.
    const markup = html('files', { rootDir: '/w', tree: TREE, onReferenceFile: () => {} });
    const name = markup.indexOf('>README.md<');
    expect(name).toBeGreaterThanOrEqual(0);
    expect(markup.indexOf(RIGHTBAR_COPY['files.copyPath'], name)).toBeGreaterThan(name);
    // The verbs share one rail behind the name (the hover-revealed group).
    expect(markup).toContain(`title="${RIGHTBAR_COPY['files.reference']}"`);
  });

  it('says a session without a workspace has none, instead of an empty tree', () => {
    expect(html('files', { rootDir: '' })).toContain(RIGHTBAR_COPY['files.noWorkspace']);
  });

  it('draws the terminal as an emulator host, not a fake prompt of our own', () => {
    // The pipe-shell era's empty state pretended at a terminal (「真实的
    // shell」+ note it was not a TTY). A real PTY needs none of that: the
    // mount effect builds xterm into this host; the render path only mounts it.
    const markup = html('terminal', { rootDir: '/w' });
    expect(markup).toContain('data-term-screen');
    expect(markup).not.toContain(RIGHTBAR_COPY['term.exited']);
  });

  it('carries a status band with a restart affordance when the terminal ended', () => {
    const markup = html('terminal', {
      rootDir: '/w',
      term: { status: 'exited', exitCode: 2, feed: null, session: '/n/one.jsonl' },
    });
    expect(markup).toContain(RIGHTBAR_COPY['term.code'].replace('{code}', '2'));
    expect(markup).toContain(`title="${RIGHTBAR_COPY['term.restart']}"`);
  });

  it('says why the terminal could not be opened instead of drawing nothing', () => {
    const markup = html('terminal', {
      rootDir: '/w',
      term: { status: 'unavailable', error: 'Cannot find module', feed: null, session: '/n/one.jsonl' },
    });
    expect(markup).toContain(RIGHTBAR_COPY['term.unavailable']);
  });

  it('offers the discovered shells in the footer picker once they are known', () => {
    // The shell choice is the reader's (dsh's own preference shape): the rows
    // are the host's DISCOVERED list — a shell that is not installed is not a
    // row — and the picker lives in the footer strip the status shares.
    const markup = html('terminal', {
      rootDir: '/w',
      shells: { items: [
        { name: 'cmd', path: 'C:/Windows/system32/cmd.exe', family: 'cmd' },
        { name: 'pwsh', path: 'C:/Program Files/PowerShell/7/pwsh.exe', family: 'pwsh' },
      ], current: 'C:/Windows/system32/cmd.exe' },
    });
    expect(markup).toContain(RIGHTBAR_COPY['term.shell']);
    expect(markup).toContain('pwsh');
    expect(markup).toContain('C:/Program Files/PowerShell/7/pwsh.exe');
    // Without the answer there is no picker, and no invented rows.
    expect(html('terminal', { rootDir: '/w' })).not.toContain(RIGHTBAR_COPY['term.shell']);
  });

  it('lists the background jobs with their status words', () => {
    const jobs: WireJobRow[] = [
      { id: 'bash-1', kind: 'bash', label: 'pnpm test', status: 'running', progress: 'running 12 tests' },
      { id: 'bash-2', kind: 'bash', label: 'pnpm build', status: 'completed', detail: 'exit code: 0' },
    ];
    const markup = html('tasks', { jobs });
    expect(markup).toContain('pnpm test');
    expect(markup).toContain(RIGHTBAR_COPY['tasks.running']);
    expect(markup).toContain(RIGHTBAR_COPY['tasks.completed']);
    expect(markup).toContain(RIGHTBAR_COPY['tasks.stop']);
  });

  it('names the reason the task list is empty instead of drawing nothing', () => {
    const markup = html('tasks', { jobs: [] });
    expect(markup).toContain(RIGHTBAR_COPY['tasks.empty']);
    expect(markup).toContain(RIGHTBAR_COPY['tasks.empty.note']);
  });
});
