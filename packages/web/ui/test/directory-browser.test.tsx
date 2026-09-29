/**
 * The workspace picker's directory browser.
 *
 * Two affordances exist because the home subtree is not the whole filesystem,
 * and the spec pins the reason each one is load-bearing:
 *
 *  - the **roots row** is the host's drive list. On Windows a drive letter is a
 *    dead end for `dirname` and the home directory lives on exactly one drive,
 *    so without this row a `D:` disk cannot be reached at all — however far up
 *    the user clicks.
 *  - the **path box** is the general escape: any location the crumb chain
 *    cannot express is typed there, which is also the reference's own answer.
 *
 * Rendered without a DOM (`renderToStaticMarkup`), so this lane stays the
 * DOM-free one the repo's front-end tests use.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DirectoryBrowserDialog } from '../src/conversation/DirectoryBrowser.js';
import type { WireDirectoryLevel } from '../src/types.js';

const LEVEL: WireDirectoryLevel = {
  path: 'C:\\Users\\me',
  home: 'C:\\Users\\me',
  parent: 'C:\\Users',
  crumbs: [{ name: 'me', path: 'C:\\Users\\me' }],
  roots: [{ name: 'C:\\', path: 'C:\\' }, { name: 'D:\\', path: 'D:\\' }],
  entries: [{ name: 'projects', path: 'C:\\Users\\me\\projects', hidden: false }],
  truncated: false,
};

const browser = (over: Partial<Parameters<typeof DirectoryBrowserDialog>[0]> = {}): string =>
  renderToStaticMarkup(
    <DirectoryBrowserDialog
      level={LEVEL}
      error={null}
      pending={false}
      onList={() => {}}
      onCreate={() => {}}
      onOpen={() => {}}
      onClose={() => {}}
      {...over}
    />,
  );

describe('DirectoryBrowserDialog', () => {
  it('offers every host volume as a jump target, not just the one home sits on', () => {
    const html = browser();
    // The drive list is the fix for "only C: is selectable": each root carries
    // its own path, so a D: disk is one click from anywhere in the tree.
    expect(html).toContain('C:\\');
    expect(html).toContain('D:\\');
    expect(html).toContain('aria-label="磁盘"');
  });

  it('labels the home crumb and marks the current level', () => {
    const html = browser();
    expect(html).toContain('主目录');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('projects');
  });

  it('exposes the path box as its own affordance, seeded from the level', () => {
    // The pencil is the way into typing a path; on POSIX the separator must be
    // `/` while on Windows it comes from the host's own `home` spelling.
    expect(browser()).toContain('aria-label="输入文件夹路径"');
    expect(browser({
      level: { ...LEVEL, path: '/home/me', home: '/home/me', crumbs: [{ name: 'me', path: '/home/me' }] },
    })).toContain('aria-label="输入文件夹路径"');
  });

  it('states the refusal beside the level instead of blanking the sheet', () => {
    // "Cannot look" and "nothing here" are different facts; a refusal keeps the
    // previous level on screen with the reason attached.
    const html = browser({ error: '目录不存在：D:\\nope' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('目录不存在');
    // The level is still drawn: the user is not dropped onto an empty dialog.
    expect(html).toContain('projects');
  });

  it('keeps the parent row only when the host reported a parent', () => {
    // At a filesystem root there is no `..`, and offering one would be a control
    // that navigates nowhere. Counted by row markup, not by the text `..`, which
    // also occurs inside ordinary paths.
    const parentRow = /_rowLabel_[a-z0-9]+">\.\.</;
    expect(browser()).toMatch(parentRow);
    const atRoot = browser({
      level: { ...LEVEL, path: 'C:\\', crumbs: [{ name: 'C:\\', path: 'C:\\' }], parent: undefined },
    });
    expect(atRoot).not.toMatch(parentRow);
  });

  it('separates "this folder is empty" from "nothing could be listed"', () => {
    // The defect: both facts shipped as the same sentence, so a host refusal
    // read as a correct empty answer. They are three readings now and each
    // carries its own state — a level that listed fine and holds nothing, a
    // request still in flight, and a failure with no level to fall back on.
    const empty = browser({
      level: { ...LEVEL, entries: [], parent: undefined },
    });
    expect(empty).toContain('data-body-state="empty"');
    expect(empty).not.toContain('data-body-state="loading"');

    const loading = browser({ level: null, pending: true });
    expect(loading).toContain('data-body-state="loading"');
    expect(loading).not.toContain('data-body-state="empty"');

    // No level and no request in flight: the sheet must not claim the folder is
    // empty — that would blame the folder for a refusal it never saw.
    const unavailable = browser({ level: null, pending: false });
    expect(unavailable).toContain('data-body-state="unavailable"');
    expect(unavailable).not.toContain('data-body-state="empty"');
  });

  it('states an empty folder even when a parent row precedes it', () => {
    // A subfolder with no children used to render a lone `..` row and nothing
    // else, which reads as a list that is still arriving.
    const html = browser({ level: { ...LEVEL, entries: [] } });
    expect(html).toMatch(/_rowLabel_[a-z0-9]+">\.\.</);
    expect(html).toContain('data-body-state="empty"');
  });

  it('names the file-picking job when the rows select instead of navigate', () => {
    // One enumeration serves two jobs — adopt a workspace, or name an `@`
    // reference — and what a row DOES differs between them. The dialog must say
    // which job it is in, and there is no Open button to adopt with in file mode
    // (every row is already the selection).
    const html = browser({ mode: 'file' });
    expect(html).not.toContain('选择工作区文件夹');
    expect(html).not.toContain('>打开</button>');
    expect(html).not.toContain('>新建文件夹</button>');
  });
});
