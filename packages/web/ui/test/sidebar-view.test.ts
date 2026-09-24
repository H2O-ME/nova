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
  sessionTitle,
  toggled,
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
  it('falls back for a log with no user prompt', () => {
    expect(sessionTitle(item('a.jsonl', undefined, ''))).toBe('（无标题）');
    expect(sessionTitle(item('a.jsonl', undefined, '修 sidebar'))).toBe('修 sidebar');
  });
});

describe('cls', () => {
  it('joins what is on and drops what is not', () => {
    expect(cls('a', false, undefined, 'b')).toBe('a b');
    expect(cls()).toBe('');
  });
});

describe('toggled', () => {
it('adds a key once and drops it on the second call', () => {
    expect(toggled([], 'a')).toEqual(['a']);
    expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
    expect(toggled(toggled([], 'a'), 'a')).toEqual([]);
  });

  it('never mutates the set it was given', () => {
    const keys = ['a'];
    toggled(keys, 'b');
    expect(keys).toEqual(['a']);
  });
});