/**
 * Fetch the corpus activity reading from the host's dashboard route.
 *
 * Pure-ish (returns a Promise, no React), kept separate from the card so the
 * card's render stays a pure function of its props and the fetch is testable
 * without a component tree. The cookie the auth gate set travels with the
 * same-origin request, so this needs no headers of its own.
 */
import type { DayBucket, WorkspaceBucket } from '../types.js';

export interface DashboardReading {
  days: DayBucket[];
  workspaces: WorkspaceBucket[];
  sessions: number;
  totals: { requests: number; prompt: number; completion: number };
}

/** The dashboard route the host owns. */
const DASHBOARD_PATH = '/api/dashboard';

export async function fetchDashboard(): Promise<DashboardReading | undefined> {
  try {
    const response = await fetch(DASHBOARD_PATH, { method: 'GET' });
    if (!response.ok) return undefined;
    const payload = (await response.json().catch(() => undefined)) as
      | { ok?: boolean; aggregate?: unknown }
      | undefined;
    if (payload?.ok !== true || payload.aggregate === undefined) return undefined;
    // Trust the host's shape — the route is gated and produces one well-formed
    // payload. A bad shape reads as "no dashboard" rather than crashing the card.
    const a = payload.aggregate as DashboardReading;
    if (!Array.isArray(a.days) || !Array.isArray(a.workspaces)) return undefined;
    return a;
  } catch {
    return undefined;
  }
}
