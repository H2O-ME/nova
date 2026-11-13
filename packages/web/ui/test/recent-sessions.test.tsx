/**
 * The hero's 最近会话 list: the two invariants the operator asked for, plus the
 * empty case.
 *
 * Ordering is by `mtime` DESC and computed here, not inherited from the frame:
 * a list that claims to be recent must sort by the fact it claims. The session
 * the kernel is attached to is excluded (resuming it is a no-op), and a list
 * with nothing to resume renders NO block at all rather than an empty shelf.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RECENT_SESSION_LIMIT, RecentSessions, recentSessions } from '../src/conversation/RecentSessions.js';
import type { SessionListItem } from '../src/types.js';

const item = (file: string, mtime: number, workspace?: string): SessionListItem => ({
  file,
  title: file,
  mtime,
  ...(workspace !== undefined ? { workspace } : {}),
});

const html = (items: readonly SessionListItem[] | null, currentFile?: string): string =>
  renderToStaticMarkup(
    <RecentSessions
      items={items}
      {...(currentFile !== undefined ? { currentFile } : {})}
      onOpen={() => undefined}
    />,
  );

describe('recentSessions', () => {
  it('sorts by mtime DESC and keeps at most four, whatever order arrived', () => {
    const rows = recentSessions(
      [item('old', 10), item('new', 30), item('mid', 20), item('older', 5), item('oldest', 1)],
      undefined,
    );
    expect(RECENT_SESSION_LIMIT).toBe(4);
    expect(rows.map((row) => row.file)).toEqual(['new', 'mid', 'old', 'older']);
  });

  it('leaves out the session the kernel is already attached to', () => {
    const rows = recentSessions([item('current', 30), item('other', 10)], 'current');
    expect(rows.map((row) => row.file)).toEqual(['other']);
  });
});

describe('RecentSessions', () => {
  it('holds a pending line before the first frame, renders nothing when there is nothing to resume', () => {
    // Before the first `sessions` frame the caption holds with the pending
    // line, so the rows land in place instead of the block popping in.
    expect(html(null)).toContain('正在载入');
    // After the frame: an empty list renders no shelf at all.
    expect(html([])).toBe('');
    // The only session on disk is the one already open.
    expect(html([item('current', 5)], 'current')).toBe('');
  });

  it('names each row by title, workspace and age, with the ungrouped fallback', () => {
    const now = Date.now();
    const out = html([
      item('newest', now, 'D:\\web\\agent'),
      item('older', now - 3 * 3_600_000, ''),
    ]);
    expect(out).toContain('newest');
    expect(out).toContain('agent');
    // An empty workspace is the ungrouped bucket, never an empty cell.
    expect(out).toContain('未分组');
    expect(out).toContain('3小时');
  });
});
