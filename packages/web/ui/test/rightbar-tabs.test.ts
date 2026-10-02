/**
 * The right panel's tab vocabulary (`rightbar/tabs.ts`).
 *
 * The rule this file exists for: the strip offers exactly the four pages, and
 * the id guard rejects anything else — `editor`, which WAS a tab until the
 * files page absorbed it, must never come back as a page.
 */
import { describe, expect, it } from 'vitest';
import { isTabId, RIGHTBAR_TABS } from '../src/rightbar/tabs.js';

describe('right panel tabs', () => {
  it('offers the four pages', () => {
    expect(RIGHTBAR_TABS.map((tab) => tab.id)).toEqual(['changes', 'files', 'tasks', 'terminal']);
    expect(RIGHTBAR_TABS.map((tab) => tab.label)).toEqual(['变更', '文件', '任务', '终端']);
  });

  it('recognizes only its own ids — `editor` is no longer one', () => {
    // The editor is a PANE of the files window now, not a page of its own: a
    // strip that still offered it would be offering the tab switch the merge
    // was made to remove.
    expect(isTabId('terminal')).toBe(true);
    expect(isTabId('files')).toBe(true);
    expect(isTabId('tasks')).toBe(true);
    expect(isTabId('editor')).toBe(false);
    expect(isTabId('diffs')).toBe(false);
    expect(isTabId(undefined)).toBe(false);
    expect(isTabId(7)).toBe(false);
  });
});
