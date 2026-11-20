/**
 * The corpus activity reading, asked over a `dashboard` frame.
 *
 * Pure-ish (returns a Promise, no React), kept separate from the card so the
 * card's render stays a pure function of its props and the fetch is testable
 * without a component tree. The frame replaces the old `/api/dashboard` GET:
 * the reading is whatever the host's own fold produces, so a client cannot
 * name a different corpus than the one it is talking to.
 */
import type { DayBucket, WorkspaceBucket } from '../types.js';
import { requestFrame } from '../client/requests.js';

export interface DashboardReading {
  days: DayBucket[];
  workspaces: WorkspaceBucket[];
  sessions: number;
  totals: { requests: number; prompt: number; completion: number };
}

export async function fetchDashboard(): Promise<DashboardReading | undefined> {
  try {
    // `dashboard` 帧没有关联字段，也不该有：同一时刻至多一个在飞（requests.ts
    // 按回帧类型排队），回帧归属无歧义。
    const reply = await requestFrame({ type: 'dashboard' }, 'dashboard');
    if (reply === undefined || reply.ok !== true || reply.aggregate === undefined) return undefined;
    // Trust the host's shape — the frame is gated and produces one well-formed
    // payload. A bad shape reads as "no dashboard" rather than crashing the card.
    const a = reply.aggregate as DashboardReading;
    if (!Array.isArray(a.days) || !Array.isArray(a.workspaces)) return undefined;
    return a;
  } catch {
    return undefined;
  }
}
