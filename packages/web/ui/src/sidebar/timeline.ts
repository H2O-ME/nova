/**
 * Timeline grouping for the session list (pure, DOM-free): the sidebar's
 * default view files sessions under calendar-day buckets — 今天 / 昨天 /
 * N 天前 / 本周 / 上周 / 本月 / 更早 — the operator's reference's own
 * `timelineDates.ts` semantics. A calendar day, not a 24h age: a session from
 * 23:59 yesterday is 昨天 even if it is one minute old, which is the question
 * a scanned list is really asking. Each distinct day beyond yesterday is its
 * OWN section (`2 天前` and `3 天前` are two headings), like the reference.
 *
 * Buckets are derived from epoch pairs so the vitest lane can date a list
 * without a DOM, and so the row stamps (`relative-time.ts`) and the group
 * headings cannot disagree about what day it is.
 */
import type { SessionListItem } from '../types.js';

/** `N 天前` covers days 2–3 (the reference's own `<= 3` rule). */
const DAYS_AGO_MAX = 3;

/**
 * The section a timestamp's calendar day belongs to, relative to `now`.
 * @param at - epoch ms of the session's last update.
 * @param now - current epoch ms (injected, so rendering stays pure).
 * @returns the section key: a named bucket, or `days:{n}` for the per-day
 *   天前 sections (n = whole calendar days back, 2–3).
 */
export function timelineSection(at: number, now: number): string {
  const days = calendarDay(now) - calendarDay(at);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days <= DAYS_AGO_MAX) return `days:${days}`;
  // Weeks compare on a Monday-aligned week index (epoch day 4 is a Monday),
  // so the tail of this week stays 本周 and the previous Monday's week is 上周.
  const weekDelta = Math.floor((calendarDay(now) - 4) / 7) - Math.floor((calendarDay(at) - 4) / 7);
  if (weekDelta === 0) return 'thisWeek';
  if (weekDelta === 1) return 'lastWeek';
  const month = (t: number): number => new Date(t).getFullYear() * 12 + new Date(t).getMonth();
  if (month(at) === month(now)) return 'thisMonth';
  return 'older';
}

/** The heading text for one section key (`days:{n}` resolves its count). */
export function timelineSectionLabel(section: string): string {
  if (section.startsWith('days:')) return `${section.slice(5)} 天前`;
  switch (section) {
    case 'today': return '今天';
    case 'yesterday': return '昨天';
    case 'thisWeek': return '本周';
    case 'lastWeek': return '上周';
    case 'thisMonth': return '本月';
    default: return '更早';
  }
}

/** Local calendar day number: whole days since the epoch, DST-safe. */
function calendarDay(at: number): number {
  const date = new Date(at);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

/** One ordered section of sessions, newest-first inside. */
export interface TimelineGroup {
  /** Stable fold/animation key (the section key). */
  key: string;
  /** Heading text, already resolved. */
  label: string;
  /** The section's sessions, in the order they arrived (newest first). */
  items: SessionListItem[];
}

/**
 * Group the newest-first session list into timeline sections, preserving row
 * order inside each section and dropping empty sections (a heading with
 * nothing under it is noise, and the reference never renders one).
 * @param items - the host's session rows.
 * @param now - current epoch ms (injected).
 * @returns the non-empty sections, oldest last.
 */
export function groupByTimeline(items: readonly SessionListItem[], now: number): TimelineGroup[] {
  const groups: TimelineGroup[] = [];
  const byKey = new Map<string, TimelineGroup>();
  for (const item of items) {
    const key = timelineSection(item.mtime, now);
    let group = byKey.get(key);
    if (group === undefined) {
      group = { key, label: timelineSectionLabel(key), items: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
