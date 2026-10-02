/**
 * The 上下文 pane's dashboard card: a cross-session activity overview.
 *
 * Every OTHER card in the pane reads the CURRENT session's fold; this one
 * reads the whole corpus — every stored session log under `~/.nova/sessions`,
 * folded by the host's own `aggregateSessions` into per-day and per-workspace
 * buckets. The Heatmap card already shows one session's per-day density; this
 * card is the same axis at corpus scale, plus a workspace leaderboard.
 *
 * The card SELF-FETCHES on mount (the only card that does — the others ride
 * the `ready` baseline), because the dashboard reading is independent of the
 * open session and a corpus walk is too heavy to send on every `ready`. It HIDES
 * itself while loading or when the fetch fails (an offline-ish server, an empty
 * sessions dir), so the pane never shows a broken "no data" card on a fresh
 * install.
 *
 * Purposely minimal: two compact summaries (a 14-day sparkline and a top-5
 * workspace list), no charts. The trend card already plots per-request cost
 * over time; the heatmap already draws per-day density. This card answers the
 * ONE question the others cannot: "across ALL my sessions, what's active."
 */
import { useEffect, useState } from 'react';
import type { DayBucket, WorkspaceBucket } from '../types.js';
import { formatExactTokens } from '../format.js';
import { fetchDashboard, type DashboardReading } from './dashboard-fetch.js';
import css from './ContextView.module.css';

/** Days the sparkline shows — a fortnight, matching the heatmap's window-ish scale. */
const SPARK_DAYS = 14;

/** Workspaces the leaderboard lists. */
const TOP_WORKSPACES = 5;

export function DashboardCard(): JSX.Element {
  const [reading, setReading] = useState<DashboardReading | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void fetchDashboard().then((r) => {
      if (!cancelled) setReading(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Hide while loading and on failure: a fresh install has no corpus, and a
  // server that didn't wire the route (older host, a test shell) should not
  // paint an empty card.
  if (reading === undefined || reading.totals.requests === 0) return <></>;
  return <DashboardCardView reading={reading} />;
}

/** The pure rendering of one dashboard reading — extracted so tests can assert
 *  it without driving a fetch and waiting for the effect. */
export function DashboardCardView({ reading }: { reading: DashboardReading }): JSX.Element {
  return (
    <section className={css.card} data-context-dashboard="">
      <header className={css.cardHead}>
        <h3 className={css.cardTitle}>跨会话活动</h3>
        <span className={css.trailing}>{reading.sessions} 个会话 · {reading.totals.requests} 次请求</span>
      </header>
      <Sparkline days={reading.days} />
      <WorkspaceList workspaces={reading.workspaces} />
      <p className={css.dashTotals}>
        合计约 {formatExactTokens(reading.totals.prompt + reading.totals.completion)} tokens
      </p>
    </section>
  );
}

/** A 14-day activity sparkline — newest day on the right, density as bar height. */
function Sparkline({ days }: { days: readonly DayBucket[] }): JSX.Element {
  const recent = recentDays(days, SPARK_DAYS);
  const max = recent.reduce((m, b) => Math.max(m, b.requests), 0);
  return (
    <div className={css.dashSpark} data-dashboard-spark="">
      {recent.map((b) => {
        const ratio = max > 0 ? b.requests / max : 0;
        const height = ratio > 0 ? Math.max(6, Math.round(ratio * 100)) : 0;
        return (
          <span
            key={b.key}
            className={css.dashSparkBar}
            style={{ height: `${height}%` }}
            title={`${b.key}：${b.requests} 次请求`}
            data-empty={b.requests === 0 ? 'true' : undefined}
          />
        );
      })}
    </div>
  );
}

/** The leaderboard: top workspaces by request count. */
function WorkspaceList({ workspaces }: { workspaces: readonly WorkspaceBucket[] }): JSX.Element {
  const top = workspaces.slice(0, TOP_WORKSPACES);
  if (top.length === 0) return <></>;
  return (
    <ul className={css.dashWorkspaces}>
      {top.map((ws) => (
        <li key={ws.workspace} className={css.dashWorkspaceRow}>
          <span className={css.dashWorkspacePath}>{workspaceLabel(ws.workspace)}</span>
          <span className={css.dashWorkspaceMeta}>
            {ws.sessions} 会话 · {ws.requests} 请求
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Last `n` days from the reading, filling gaps with zero-request buckets. */
function recentDays(days: readonly DayBucket[], n: number): DayBucket[] {
  const byKey = new Map(days.map((d) => [d.key, d]));
  const out: DayBucket[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = dayKeyOf(d);
    const bucket = byKey.get(key);
    out.push(bucket ?? { key, requests: 0, prompt: 0, completion: 0 });
  }
  return out;
}

/** Local YYYY-MM-DD — matches the host's own `dayKey` used by `aggregateSessions`. */
function dayKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Pretty-print a workspace path: the sentinel maps to "未分组", otherwise the basename. */
function workspaceLabel(workspace: string): string {
  if (workspace === '__none__') return '未分组';
  // Show the leaf — full paths overflow the column.
  const parts = workspace.replace(/\\/g, '/').split('/').filter((p) => p.length > 0);
  const leaf = parts[parts.length - 1];
  return leaf ?? workspace;
}
