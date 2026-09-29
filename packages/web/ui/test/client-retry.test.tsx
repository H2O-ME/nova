import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { nextRetry } from '../src/client.js';
import { ConnectionIndicator } from '../src/sidebar/ConnectionIndicator.js';
import { Sidebar } from '../src/sidebar/Sidebar.js';
import { indicatorState, indicatorTransition } from '../src/sidebar/view.js';

/**
 * The socket's retry schedule. The effect that uses it needs a DOM, so the rule
 * itself lives in a pure function: this is where the backoff shape is pinned.
 */
describe('nextRetry', () => {
  it('waits the current delay and doubles it, capped', () => {
    const first = nextRetry(500, false);
    expect(first).toEqual({ delayMs: 500, nextMs: 1000 });
    // The cap holds: a long outage retries twice a minute, not exponentially.
    const atCap = nextRetry(5000, false);
    expect(atCap).toEqual({ delayMs: 5000, nextMs: 5000 });
    expect(nextRetry(100_000, false).nextMs).toBe(5000);
  });

  it('collapses the wait and re-seeds the schedule for a manual retry', () => {
    // The regression this pins: pressing 重试 only called `close()`, so the
    // reader inherited the grown backoff — their own click pushed the next
    // attempt FURTHER away the longer the outage had lasted.
    expect(nextRetry(5000, true)).toEqual({ delayMs: 0, nextMs: 500 });
    expect(nextRetry(0, true)).toEqual({ delayMs: 0, nextMs: 500 });
  });
});

/**
 * The outage readout has two branches: an inert label when no retry handler
 * arrives, and a button that actually retries when one does. `SidebarFoot` never
 * passed `onReconnect`, so the button branch — its `onClick`, its accessible
 * labels and its `.hoverLabel` — was unreachable in the shipped app.
 */
describe('ConnectionIndicator retry affordance', () => {
  const copy = {
    disconnectedLabel: '连接已断开',
    reconnectLabel: '重试',
    connectingLabel: '正在重连',
    recoveredLabel: '连接成功',
    reconnectActionLabel: '连接异常，点击立即重连',
    restartActionLabel: '连接中断，正在自动重试，点击立即重连',
  };

  it('renders a retrying BUTTON when onReconnect arrives', () => {
    let clicks = 0;
    const html = renderToStaticMarkup(
      <ConnectionIndicator state="disconnected" {...copy} onReconnect={() => { clicks += 1; }} />,
    );
    expect(html).toContain('<button');
    expect(html).toContain('连接已断开');
    expect(html).toContain('重试');
    // The inert branch's `role="status"` must not be what the reader gets: a
    // status element cannot be clicked, which is the whole defect.
    expect(html).not.toContain('role="status"');
    expect(clicks).toBe(0);
  });

  it('falls back to the inert readout when no handler is given', () => {
    const html = renderToStaticMarkup(<ConnectionIndicator state="disconnected" {...copy} />);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('<button');
  });

  it('renders nothing at all when connected and settled', () => {
    expect(renderToStaticMarkup(<ConnectionIndicator state={undefined} {...copy} />)).toBe('');
  });

  it('fades out instead of vanishing, and comes back immediately', () => {
    // The regression this pins: `state === undefined` used to return null on
    // the spot, so the pill vanished in the frame the socket recovered. Now the
    // last state is held for the exit transition (the component owns the timer;
    // this is the rule it follows).
    const held = indicatorTransition('connecting', undefined);
    expect(held).toEqual({ rendered: 'connecting', leaving: true });
    expect(indicatorTransition('recovered', undefined)).toEqual({ rendered: 'recovered', leaving: true });
    // Nothing on screen, nothing to fade.
    expect(indicatorTransition(undefined, undefined)).toEqual({ rendered: undefined, leaving: false });
    // A returning state is drawn at once and is never marked as leaving.
    expect(indicatorTransition('connecting', 'disconnected')).toEqual({ rendered: 'disconnected', leaving: false });
    expect(indicatorTransition('disconnected', 'connecting')).toEqual({ rendered: 'connecting', leaving: false });
    // Still nothing at all at rest.
    expect(renderToStaticMarkup(<ConnectionIndicator state={undefined} {...copy} />)).toBe('');
  });

  it('lets the connecting hold win over the recovery confirmation', () => {
    // The reference's order: a retry that lands inside the minimum-visible
    // window keeps showing 自动重连中 until the pill has been up long enough,
    // and only then flips to 连接成功 — otherwise the pill flashes for one frame
    // and the confirmation window is eaten by the hold.
    expect(indicatorState('connecting', false)).toBe('connecting');
    expect(indicatorState('connecting', false, true)).toBe('connecting');
    // The hold outranks `recovered` even once the socket reports open.
    expect(indicatorState('open', true, true)).toBe('connecting');
    expect(indicatorState('open', true, false)).toBe('recovered');
    // An outage is never hidden by the hold.
    expect(indicatorState('closed', false, true)).toBe('connecting');
    expect(indicatorState('closed', false, false)).toBe('disconnected');
    expect(indicatorState('open', false, false)).toBeUndefined();
  });

  it('reaches the button branch through Sidebar, the only real call chain', () => {
    // The regression this pins, and why the first version of this test was
    // worthless: rendering `ConnectionIndicator` with a stub `onReconnect`
    // proves the indicator's chrome, not that anything ever hands it one. The
    // chain is App → Sidebar → SidebarFoot → ConnectionIndicator, and BOTH
    // middle links were missing the prop, so the shipped app could never show
    // the button. Drive it from the top so either link breaking turns this red.
    const html = renderToStaticMarkup(
      <Sidebar
        items={null}
        currentFile=""
        collapsed={false}
        connection="closed"
        onReconnect={() => undefined}
        send={() => undefined}
        settingsOpen={false}
        onOpenSettings={() => undefined}
        onDeleteSession={() => undefined}
        onReloadSessions={() => undefined}
        onToggleCollapsed={() => undefined}
      />,
    );
    expect(html).toContain('<button');
    expect(html).toContain('立即重连');
    // The inert `role="status"` readout is what the bug shipped instead.
    expect(html).not.toContain('role="status"');
  });
});
