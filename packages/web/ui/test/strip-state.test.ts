/**
 * The strip's four reference rules, asserted on the pure transitions.
 *
 * Each test is a killing test for one rule of `dsh ui-sidebar-right`: invert the
 * rule in `strip-state.ts` and its test goes red. These live apart from the
 * panel's render tests because the rules are state, not markup — the markup can
 * only ever show one instance of them.
 */
import { describe, expect, it } from 'vitest';
import { GUIDE_TAB, type StripTabId } from '../src/rightbar/tabs.js';
import { addGuide, closeTab, focusTab, initialStrip, pickGuideEntry, type StripState } from '../src/rightbar/strip-state.js';

/** A strip with the given tabs, the last one in front. */
function strip(...tabs: StripTabId[]): StripState {
  return { tabs, front: tabs[tabs.length - 1] ?? GUIDE_TAB };
}

describe('rightbar strip transitions', () => {
  it('a fresh page load opens on the guide, not the last-visited page', () => {
    // The killing case for the old remembered-preference boot: a reload into
    // 变更 answered a question nobody asked. The doorway is the boot state.
    expect(initialStrip()).toEqual({ tabs: [GUIDE_TAB], front: GUIDE_TAB });
  });

  it('the `+` opens the start page as a tab, and a pane holds at most one', () => {
    const opened = addGuide(strip('files'));
    expect(opened).toEqual({ tabs: ['files', GUIDE_TAB], front: GUIDE_TAB });
    // The second press changes nothing (the control is not even drawn).
    expect(addGuide(opened)).toBe(opened);
  });

  it('picking an entry REPLACES the guide tab with that page', () => {
    const state = strip('changes', GUIDE_TAB);
    expect(pickGuideEntry(state, 'terminal')).toEqual({ tabs: ['changes', 'terminal'], front: 'terminal' });
  });

  it('picking an entry that is already open leaves no duplicate', () => {
    const state = strip('files', GUIDE_TAB);
    expect(pickGuideEntry(state, 'files')).toEqual({ tabs: ['files'], front: 'files' });
  });

  it('the guide standing alone is not closable', () => {
    const state = strip(GUIDE_TAB);
    expect(closeTab(state, GUIDE_TAB)).toBe(state);
  });

  it('closing the last page leaves the guide, not an empty strip', () => {
    expect(closeTab(strip('files'), 'files')).toEqual({ tabs: [GUIDE_TAB], front: GUIDE_TAB });
  });

  it('closing the front tab falls to the last remaining one', () => {
    expect(closeTab(strip('changes', 'files'), 'files').front).toBe('changes');
    // Closing a tab that is not in front keeps the front where it was.
    expect(closeTab(strip('changes', 'files'), 'changes').front).toBe('files');
  });

  it('clicking an already-open tab brings it forward without growing the strip', () => {
    const state = strip('changes', 'files');
    expect(focusTab(state, 'changes')).toEqual({ tabs: ['changes', 'files'], front: 'changes' });
  });
});
