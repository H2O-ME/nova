/**
 * The hero's workspace row.
 *
 * The two defects it shipped with: the chip must be reachable (a disabled chip
 * is a control that opens onto nothing), and the menu must always carry the
 * add-workspace route — with only remembered directories in it, a first visit
 * rendered an EMPTY menu, which is a blank white pill floating over the card
 * and no way to pick a workspace at all.
 *
 * The hero itself is no longer asserted here: its version badge moved to the
 * settings nav (`SettingsPanel`), and what remains above the composer is a mark
 * and a headline.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ADD_WORKSPACE, WorkspaceRow, workspaceMenuItems } from '../src/conversation/EmptyHero.js';

/** The row as the shell mounts it, with only the props a test cares about. */
const row = (props: Parameters<typeof WorkspaceRow>[0]): string =>
  renderToStaticMarkup(<WorkspaceRow {...props} />);

describe('workspace row', () => {
  it('renders the chip as a label when nothing can act on a pick', () => {
    const html = row({ workspace: 'agent' });
    // No picker and no browser means no control: a button that opens onto
    // nothing is worse than a plain label.
    expect(html).toContain('disabled');
    expect(html).not.toContain('aria-haspopup="menu"');
  });

  it('renders the chip as a menu trigger when it can act', () => {
    const html = row({ workspace: 'agent', onPickWorkspace: () => undefined });
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('agent');
  });

  it('marks the current workspace and offers every other remembered one', () => {
    const items = workspaceMenuItems(['D:\\web\\agent', 'D:\\web\\other'], 'D:\\web\\agent', false);
    // The current root is stated by the chip, so the menu filters it out: a menu
    // exists to disambiguate between targets.
    expect(items.map((item) => item.id)).toEqual(['D:\\web\\other']);
    expect(items[0]?.label).toBe('other');
  });

  it('always offers the directory route, even with nothing remembered', () => {
    // THE DEFECT: `recentWorkspaces` starts empty on a first visit, so a menu
    // built only from it renders zero rows — an empty white popover with no way
    // to add a workspace. The add route is therefore unconditional.
    const items = workspaceMenuItems([], 'D:\\web\\agent', true);
    expect(items.map((item) => item.id)).toEqual([ADD_WORKSPACE]);
    expect(items[0]?.label).toContain('打开文件夹');
  });

  it('leaves out the add route only when the shell has no browser to open', () => {
    // With no directory browser composed there is nothing the row could do, and
    // a row that opens nothing is worse than no row.
    expect(workspaceMenuItems([], 'D:\\web\\agent', false)).toEqual([]);
  });

  it('carries the full path as the chip tooltip, not just the basename', () => {
    const html = row({
      workspace: 'agent',
      workspacePath: 'D:\\web\\agent',
      onPickWorkspace: () => undefined,
    });
    // The label is the basename so the chip reads the same at every width; the
    // path is how a user tells two same-named folders apart.
    expect(html).toContain('title="D:\\web\\agent"');
  });
});
