/**
 * The browsing controls' pure rules: which rows a query keeps, what the
 * section reads in each mode, and the preference boundary (absent storage must
 * resolve to the grouped view rather than throwing).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LIST_COPY,
  LIST_VIEW_PREF_KEY,
  filterItems,
  readGroupMode,
  sectionLabel,
  writeGroupMode,
} from '../src/sidebar/list-view.js';
import type { SessionListItem } from '../src/types.js';

const rows: SessionListItem[] = [
  { file: '/s/3.jsonl', title: '重构 WebUI 布局', mtime: 300, workspace: 'D:\\web\\agent' },
  { file: '/s/2.jsonl', title: '修复审批弹窗', mtime: 200, workspace: 'D:\\web\\other' },
  { file: '/s/1.jsonl', title: '', mtime: 100 },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('filterItems', () => {
  it('keeps every row for an empty or blank query', () => {
    expect(filterItems(rows, '')).toHaveLength(3);
    expect(filterItems(rows, '   ')).toHaveLength(3);
  });

  it('matches titles case-insensitively and keeps arrival order', () => {
    expect(filterItems(rows, 'webui').map((row) => row.file)).toEqual(['/s/3.jsonl']);
    expect(filterItems(rows, '修复').map((row) => row.file)).toEqual(['/s/2.jsonl']);
  });

  it('answers with nothing when no title matches', () => {
    expect(filterItems(rows, '不存在的会话')).toEqual([]);
  });

  it('does not match the workspace path — the scope note says titles only', () => {
    expect(filterItems(rows, 'other')).toEqual([]);
  });
});

describe('sectionLabel', () => {
  it('names the grouping the list is drawn in', () => {
    expect(sectionLabel('workspace')).toBe(LIST_COPY['section.workspaces']);
    expect(sectionLabel('flat')).toBe(LIST_COPY['section.sessions']);
  });
});

describe('the grouping preference', () => {
  it('reads back what was written', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    });
    expect(readGroupMode()).toBe('workspace');
    writeGroupMode('flat');
    expect(store.get(LIST_VIEW_PREF_KEY)).toBe('flat');
    expect(readGroupMode()).toBe('flat');
    writeGroupMode('workspace');
    expect(readGroupMode()).toBe('workspace');
  });

  it('resolves a corrupt value and a refused write to the grouped view', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => 'nonsense',
      setItem: () => { throw new Error('denied'); },
    });
    expect(readGroupMode()).toBe('workspace');
    expect(() => { writeGroupMode('flat'); }).not.toThrow();
  });

  it('survives a browser with no storage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readGroupMode()).toBe('workspace');
    expect(() => { writeGroupMode('flat'); }).not.toThrow();
  });
});