import { describe, expect, it } from 'vitest';
import { NO_WORKSPACE_LABEL, groupByWorkspace, workspaceLabel } from '../src/session-groups.js';
import type { SessionListItem } from '../src/types.js';

const item = (file: string, workspace?: string): SessionListItem => ({
  file,
  title: file,
  mtime: 1_700_000_000_000,
  ...(workspace !== undefined ? { workspace } : {}),
});

describe('workspaceLabel', () => {
  it('takes the last path segment on either platform separator', () => {
    expect(workspaceLabel('D:\\web\\agent')).toBe('agent');
    expect(workspaceLabel('/home/me/web/agent')).toBe('agent');
    expect(workspaceLabel('/home/me/web/agent/')).toBe('agent');
  });

  it('keeps a separator-less workspace as-is', () => {
    expect(workspaceLabel('agent')).toBe('agent');
  });
});

describe('groupByWorkspace', () => {
  it('keeps the newest-first row order in groups and in group order', () => {
    const groups = groupByWorkspace([
      item('a.jsonl', 'D:\\web\\agent'),
      item('b.jsonl', 'D:\\web\\other'),
      item('c.jsonl', 'D:\\web\\agent'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['agent', 'other']);
    expect(groups[0]?.items.map((i) => i.file)).toEqual(['a.jsonl', 'c.jsonl']);
    expect(groups[1]?.path).toBe('D:\\web\\other');
  });

  it('collects sessions without a workspace under one fallback group', () => {
    const groups = groupByWorkspace([item('a.jsonl'), item('b.jsonl', 'D:\\web\\agent')]);
    const fallback = groups.find((g) => g.label === NO_WORKSPACE_LABEL);
    expect(fallback?.path).toBeUndefined();
    expect(fallback?.items.map((i) => i.file)).toEqual(['a.jsonl']);
  });

  it('returns nothing for an empty list', () => {
    expect(groupByWorkspace([])).toEqual([]);
  });
});
