/**
 * The plugin manager's view model, as pure functions.
 *
 * This lane has no DOM, so the page's rules are pinned here rather than through
 * a rendered tree: which group a row lands in, that a core row is never given a
 * switch, and that a failed row is pulled to the front. Each of those is a rule
 * a reader of the settings page depends on and none of them is visible in the
 * markup's shape.
 */
import { describe, expect, it } from 'vitest';
import {
  failedCount,
  pluginGroups,
  rowMatches,
  rowSwitchable,
  rowTier,
  rowTitle,
} from '../src/settings/row-model.js';
import type { WireRosterEntry } from '../src/types.js';

function row(overrides: Partial<WireRosterEntry> & { name: string }): WireRosterEntry {
  return { state: 'active', inject: [], enabled: true, ...overrides };
}

describe('rowTier', () => {
  it('treats a host without tiers as switchable rather than load-bearing', () => {
    // An old host knows nothing about tiers. Guessing "core" would invent a
    // lock the kernel does not have and make the row impossible to turn off —
    // which is the defect this whole page exists to fix.
    expect(rowTier(row({ name: 'fs' }))).toBe('standard');
    expect(rowTier(row({ name: 'x', tier: 'nonsense' }))).toBe('standard');
    expect(rowTier(row({ name: 'fs', tier: 'core' }))).toBe('core');
    expect(rowTier(row({ name: 'subagent', tier: 'advanced' }))).toBe('advanced');
  });

  it('never lets a core row render a switch', () => {
    expect(rowSwitchable(row({ name: 'toolbox', tier: 'core' }))).toBe(false);
    expect(rowSwitchable(row({ name: 'bash', tier: 'standard' }))).toBe(true);
    expect(rowSwitchable(row({ name: 'subagent', tier: 'advanced' }))).toBe(true);
  });
});

describe('rowTitle', () => {
  it('falls back to the identifier when the host sent no Chinese title', () => {
    expect(rowTitle(row({ name: 'fs-read', title: '读取文件' }))).toBe('读取文件');
    // An empty string is not a title: the identifier is at least a fact.
    expect(rowTitle(row({ name: 'fs-read', title: '' }))).toBe('fs-read');
    expect(rowTitle(row({ name: 'fs-read' }))).toBe('fs-read');
  });
});

describe('pluginGroups', () => {
  it('groups by tier, load-bearing first, and omits empty groups', () => {
    const groups = pluginGroups([
      row({ name: 'bash', tier: 'standard', title: '执行命令' }),
      row({ name: 'fs-read', tier: 'core', title: '读取文件' }),
      row({ name: 'subagent', tier: 'advanced', title: '子代理' }),
    ]);
    expect(groups.map((group) => group.tier)).toEqual(['core', 'standard', 'advanced']);
    // Only the core group refuses switches.
    expect(groups.map((group) => group.switchable)).toEqual([false, true, true]);
    // An empty tier contributes no header at all rather than an empty section.
    expect(pluginGroups([row({ name: 'bash', tier: 'standard' })]).map((group) => group.tier))
      .toEqual(['standard']);
  });

  it('pulls failed rows to the front of their own group', () => {
    const groups = pluginGroups([
      row({ name: 'a', tier: 'standard' }),
      row({ name: 'b', tier: 'standard', state: 'failed' }),
      row({ name: 'c', tier: 'standard' }),
    ]);
    // The group still means "standard" — a failed advanced plugin is still
    // advanced, so it is ordered within its tier rather than hoisted out of it.
    expect(groups[0]?.rows.map((entry) => entry.name)).toEqual(['b', 'a', 'c']);
    expect(failedCount([
      row({ name: 'a' }),
      row({ name: 'b', state: 'failed' }),
    ])).toBe(1);
  });
});

describe('search', () => {
  it('matches the Chinese title, the identifier, the description and injections', () => {
    const entry = row({
      name: 'fs-read',
      title: '读取文件',
      description: '读取工作区内的文件内容。',
      inject: ['tools'],
    });
    // Every one of these is a way a reader arrives at a row: the words on the
    // page, the name `/plugins` prints, what it does, and what it provides.
    expect(rowMatches(entry, '读取')).toBe(true);
    expect(rowMatches(entry, 'fs-')).toBe(true);
    expect(rowMatches(entry, '工作区')).toBe(true);
    expect(rowMatches(entry, 'tools')).toBe(true);
    expect(rowMatches(entry, 'nothing-here')).toBe(false);
    // An empty query matches everything: the box is not a filter until typed in.
    expect(rowMatches(entry, '')).toBe(true);
    // Filtering by the tier group's own words is not a match — the titles are
    // the page's structure, not a row's fact.
    expect(pluginGroups([entry], '读取文件').flatMap((group) => group.rows).length).toBe(1);
    expect(pluginGroups([entry], 'zzz').length).toBe(0);
  });
});
