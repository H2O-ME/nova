/**
 * Sidebar view logic, asserted without a DOM (the reference's own vitest lane
 * asserts the same facts: `tree.client.spec.ts` for the chunk rule and the
 * expanded-key derivation, `settings-root` for the recovery window).
 */
import { describe, expect, it } from 'vitest';
import {
  COLLAPSED_SESSION_LIMIT,
  SIDEBAR_COPY,
  autoExpandKey,
  cls,
  foldedRows,
  groupKey,
  indicatorState,
  overflowLabel,
  nextSessionLimit,
  rowKeysOf,
  sessionTitle,
  sidebarRows,
} from '../src/sidebar/view.js';
import { groupByWorkspace } from '../src/session-groups.js';
import type { SessionListItem } from '../src/types.js';

const item = (file: string, workspace?: string, title = file): SessionListItem => ({
  file,
  title,
  mtime: 1_700_000_000_000,
  ...(workspace !== undefined ? { workspace } : {}),
});

describe('foldedRows', () => {
  it('shows five rows and reports the rest as hidden', () => {
    const items = Array.from({ length: 8 }, (_, index) => item(`${index}.jsonl`));
    const folded = foldedRows(items);
    expect(folded.rows).toHaveLength(COLLAPSED_SESSION_LIMIT);
    expect(folded.hiddenCount).toBe(3);
  });

  it('hides nothing at or under the limit', () => {
    expect(foldedRows([item('a.jsonl')]).hiddenCount).toBe(0);
    expect(foldedRows([]).rows).toEqual([]);
  });
});

describe('overflowLabel', () => {
  it('counts the hidden rows, and collapses on the open side', () => {
    // 文案本身归 copy 表，测试只钉契约：模板带占位符，且隐藏数被真的填进去。
    const expand = SIDEBAR_COPY['sessions.expand'];
    expect(expand).toContain('{n}');
    expect(overflowLabel(3, false)).toBe(expand.replace('{n}', '3'));
    expect(overflowLabel(7, false)).toContain('7');
    expect(overflowLabel(3, true)).toBe(SIDEBAR_COPY['sessions.collapse']);
  });
});

describe('autoExpandKey', () => {
  const groups = groupByWorkspace([item('a.jsonl', 'D:\\web\\agent'), item('b.jsonl', 'D:\\web\\other')]);

  it('names the group owning the current session once', () => {
    expect(autoExpandKey(groups, 'b.jsonl', {})).toBe('D:\\web\\other');
  });

  it('leaves a group the user already folded or opened alone', () => {
    expect(autoExpandKey(groups, 'b.jsonl', { 'D:\\web\\other': false })).toBeUndefined();
    expect(autoExpandKey(groups, 'b.jsonl', { 'D:\\web\\other': true })).toBeUndefined();
  });

  it('has nothing to reveal without a current session or a matching row', () => {
    expect(autoExpandKey(groups, '', {})).toBeUndefined();
    expect(autoExpandKey(groups, 'ghost.jsonl', {})).toBeUndefined();
  });
});

describe('groupKey', () => {
  it('keys the ungrouped bucket with the empty string', () => {
    const groups = groupByWorkspace([item('a.jsonl', '/w'), item('b.jsonl')]);
    const grouped = groups.find((group) => group.path !== undefined);
    const ungrouped = groups.find((group) => group.path === undefined);
    expect(grouped === undefined ? 'missing' : groupKey(grouped)).toBe('/w');
    expect(ungrouped === undefined ? 'missing' : groupKey(ungrouped)).toBe('');
  });
});

describe('indicatorState', () => {
  it('always reports an outage or a retry', () => {
    expect(indicatorState('closed', false)).toBe('disconnected');
    expect(indicatorState('connecting', false)).toBe('connecting');
  });

  it('reports a healthy socket only during the recovery confirmation', () => {
    expect(indicatorState('open', false)).toBeUndefined();
    expect(indicatorState('open', true)).toBe('recovered');
  });
});

describe('sessionTitle', () => {
  it('falls back to the new-session word for a log with no user prompt', () => {
    expect(sessionTitle(item('a.jsonl', undefined, ''))).toBe('新会话');
    expect(sessionTitle(item('a.jsonl', undefined, '修 sidebar'))).toBe('修 sidebar');
  });
});

describe('cls', () => {
  it('joins what is on and drops what is not', () => {
    expect(cls('a', false, undefined, 'b')).toBe('a b');
    expect(cls()).toBe('');
  });
});


/**
 * The row tree is what both the markup and the FLIP animation read. These
 * assertions therefore cover two contracts at once: what the reader sees, and
 * that the keys handed to `AnimatedRows` describe THAT list (a key set with a
 * row the markup omits would animate a row that is not on screen).
 */
describe('sidebarRows', () => {
  const items = [item('a.jsonl', 'D:/proj'), item('b.jsonl', 'D:/proj')];
  const groups = groupByWorkspace(items);
  const base = {
    items,
    groups,
    mode: 'workspace' as const,
    query: '',
    searching: false,
    expansion: {} as Record<string, boolean>,
    sessionLimits: {},
    currentFile: '',
  };

  it('shows the loading placeholder before the first answer, and only that', () => {
    const rows = sidebarRows({ ...base, items: null, groups: [] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'message', key: 'loading' });
  });

  it('says the list is empty rather than rendering nothing', () => {
    const rows = sidebarRows({ ...base, items: [], groups: [] });
    expect(rows[0]).toMatchObject({ kind: 'message', key: 'empty' });
  });

  it('renders a collapsed group header with no children', () => {
    const rows = sidebarRows(base);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'group', expanded: false });
    expect(rows[0]?.kind === 'group' ? rows[0].children : []).toEqual([]);
  });

  it('puts an expanded group\'s sessions under its own header', () => {
    const rows = sidebarRows({ ...base, expansion: { 'D:/proj': true } });
    const group = rows[0];
    expect(group?.kind === 'group' ? group.children.map((child) => child.key) : []).toEqual(['a.jsonl', 'b.jsonl']);
    // Depth first, matching how the markup nests: header, then its rows.
    expect(rowKeysOf(rows)).toEqual(['group:D:/proj', 'a.jsonl', 'b.jsonl']);
  });

  it('adds an overflow row once a group exceeds the fold limit', () => {
    const many = Array.from({ length: 8 }, (_, index) => item(`${index}.jsonl`, 'D:/big'));
    const rows = sidebarRows({ ...base, items: many, groups: groupByWorkspace(many), expansion: { 'D:/big': true } });
    const children = rows[0]?.kind === 'group' ? rows[0].children : [];
    expect(children).toHaveLength(COLLAPSED_SESSION_LIMIT + 1);
    expect(children.at(-1)).toMatchObject({ kind: 'message', key: 'overflow:D:/big' });
    expect(rows[0]?.kind === 'group' ? rows[0].hiddenCount : 0).toBe(3);
  });

  it('keeps the control after revealing, where it reads as the way back', () => {
    const many = Array.from({ length: 8 }, (_, index) => item(`${index}.jsonl`, 'D:/big'));
    const rows = sidebarRows({
      ...base,
      items: many,
      groups: groupByWorkspace(many),
      expansion: { 'D:/big': true },
      sessionLimits: { 'D:/big': Number.POSITIVE_INFINITY },
    });
    const children = rows[0]?.kind === 'group' ? rows[0].children : [];
    // All eight sessions show, and the control stays as the collapse gesture
    // rather than disappearing (the reference's own rule: `hiddenCount` is the
    // group's, not the current view's).
    expect(children).toHaveLength(9);
    const control = children.at(-1);
    expect(control).toMatchObject({ kind: 'message', key: 'overflow:D:/big' });
    expect(control?.kind === 'message' ? control.text : '').toBe(overflowLabel(3, true));
  });

  it('reveals one chunk per press instead of the whole group', () => {
    // The regression this pins: the control used to toggle a BOOLEAN membership
    // set, so one press took a 200-session workspace from 5 rows to 200. The
    // reference steps by `COLLAPSED_SESSION_LIMIT` and only jumps to the end on
    // the press that would otherwise leave a second overflow row behind.
    expect(COLLAPSED_SESSION_LIMIT).toBe(5);

    // Far more hidden than one chunk: grow by exactly one chunk.
    expect(nextSessionLimit(undefined, 40, false)).toBe(10);
    expect(nextSessionLimit(10, 30, false)).toBe(15);
    // The tail fits in the next chunk: open fully, so the last press lands on
    // 收起 rather than a second overflow row holding two sessions.
    expect(nextSessionLimit(15, 4, false)).toBe(Number.POSITIVE_INFINITY);
    expect(nextSessionLimit(15, COLLAPSED_SESSION_LIMIT, false)).toBe(Number.POSITIVE_INFINITY);
    // An open group folds back to the collapsed chunk.
    expect(nextSessionLimit(Number.POSITIVE_INFINITY, 0, true)).toBe(COLLAPSED_SESSION_LIMIT);
  });

  it('draws only the group’s current chunk, and counts the rest', () => {
    const many = Array.from({ length: 40 }, (_, index) => item(`${index}.jsonl`, 'D:/big'));
    const rows = sidebarRows({
      ...base,
      items: many,
      groups: groupByWorkspace(many),
      expansion: { 'D:/big': true },
      sessionLimits: { 'D:/big': 10 },
    });
    const children = rows[0]?.kind === 'group' ? rows[0].children : [];
    // Ten sessions plus the control.
    expect(children).toHaveLength(11);
    expect(children.at(-1)?.kind === 'message' ? children.at(-1)?.key : '').toBe('overflow:D:/big');
  });

  it('replaces the tree with one flat run while searching', () => {
    const rows = sidebarRows({ ...base, searching: true, query: 'b' });
    // The scope note first, then matches from any workspace — no group header.
    expect(rows.map((row) => row.key)).toEqual(['search-note', 'b.jsonl']);
    expect(rows.some((row) => row.kind === 'group')).toBe(false);
    expect(rows[0]).toMatchObject({ note: true });
  });

  it('reports an unmatched query rather than an empty screen', () => {
    const rows = sidebarRows({ ...base, searching: true, query: 'zzz' });
    expect(rows[0]).toMatchObject({ kind: 'message', key: 'no-matches' });
  });

  it('flattens the list in flat mode', () => {
    const rows = sidebarRows({ ...base, mode: 'flat' });
    expect(rows.map((row) => row.key)).toEqual(['a.jsonl', 'b.jsonl']);
    expect(rowKeysOf(rows)).toEqual(['a.jsonl', 'b.jsonl']);
  });

  it('flags the group holding the current session', () => {
    const rows = sidebarRows({ ...base, currentFile: 'b.jsonl' });
    expect(rows[0]).toMatchObject({ kind: 'group', containsCurrent: true });
    expect(sidebarRows({ ...base, currentFile: 'elsewhere.jsonl' })[0]).toMatchObject({ containsCurrent: false });
  });

  it('gives every row a key, and no two in one render the same', () => {
    const rows = sidebarRows({ ...base, expansion: { 'D:/proj': true } });
    const keys = rowKeysOf(rows);
    expect(keys.every((key) => key.length > 0)).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
