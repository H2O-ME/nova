/**
 * The message-chrome lane: the contracts the transcript's copy/branch/clock
 * row, the compaction marker and the local-day clock seat publish to their
 * owners. Static markup only (this lane has no DOM), so every assertion is
 * about the hooks, accessible names and degradation behavior a caller or a
 * ported stylesheet depends on — never about the exact user-facing sentence.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CompactionItem } from '../src/chat/CompactionItem.js';
import { MessageIconActions } from '../src/chat/MessageIconActions.js';
import { AssistantTailRow, UserMessageRow } from '../src/chat/MessageItem.js';
import { formatClock } from '../src/format.js';

/** A fixpoint instant so the clock assertions do not depend on the wall clock. */
const NOON = new Date(2026, 8, 25, 12, 0, 0).getTime();

describe('message icon actions', () => {
  it('publishes the clock side and names both controls', () => {
    const start = renderToStaticMarkup(createElement(MessageIconActions, {
      text: 'hi',
      time: NOON,
      clock: 'start',
    }));
    expect(start).toContain('data-clock="start"');
    expect(start).toContain('aria-label="复制"');
    // A user row without a branch slot offers copy only.
    expect(start).not.toContain('分叉');
    const end = renderToStaticMarkup(createElement(MessageIconActions, {
      text: 'answer',
      clock: 'end',
    }));
    expect(end).toContain('data-clock="end"');
  });

  it('renders the usage trigger in BOTH clock seats, not only the trailing one', () => {
    // The regression this pins: `endInfo` was computed for the `end` branch only
    // and then rendered alone, so a caller that chose `clock="start"` had its
    // `usageAction` accepted as a prop and silently thrown away. dsh's tail is
    // `clock === 'end' ? <span>{usageAction}{clockEl}</span> : usageAction`.
    const usage = createElement('span', { 'data-usage-probe': 'yes' });
    const start = renderToStaticMarkup(createElement(MessageIconActions, {
      text: 'hi', time: NOON, clock: 'start', usageAction: usage,
    }));
    expect(start).toContain('data-usage-probe="yes"');
    const end = renderToStaticMarkup(createElement(MessageIconActions, {
      text: 'answer', time: NOON, clock: 'end', usageAction: usage,
    }));
    expect(end).toContain('data-usage-probe="yes"');
    // Only the trailing seat groups it with the clock, which is what the extra
    // margin exists for; the leading seat must not invent that wrapper.
    expect(end).toContain('endInfo');
  });

  it('keeps an unavailable branch focusable and explains why', () => {    const out = renderToStaticMarkup(createElement(MessageIconActions, {
      text: 'answer',
      clock: 'end',
      onBranch: () => {},
      branchUnavailable: true,
    }));
    // Never the native `disabled` attribute: the control must still deliver
    // hover/focus so the reason can be read, and the reason is the described
    // text rather than the accessible name.
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain('data-unavailable="true"');
    expect(out).not.toContain('disabled=""');
    const described = /aria-describedby="([^"]+)"/.exec(out)?.[1];
    expect(described).toBeDefined();
    expect(out).toContain(`id="${String(described)}"`);
    // The accessible name stays the action, so a screen reader announces what
    // the control would do plus why it will not.
    expect(out).toContain('aria-label="在新对话中分支"');
  });

  it('renders the branch control ONLY when a caller supplies the action', () => {
    // The regression this pins: the test above proves the button's CHROME is
    // right, but it hand-feeds `onBranch`, so it stayed green while no
    // production caller ever passed it — the button was unreachable in the real
    // app (probe: `AssistantTailRow` rendered 'answer' + copy and no 分支). That
    // is `branchUnavailable` describing a seat that does not exist. This asserts
    // the other half: the rows the flow layer actually builds offer copy alone,
    // and the reason they may must be stated rather than assumed.
    const tail = renderToStaticMarkup(createElement(AssistantTailRow, {
      text: 'answer',
      time: NOON,
      reveal: 'always',
    }));
    expect(tail).toContain('aria-label="复制"');
    expect(tail).not.toContain('分支');
    // A capability, when one lands, must arrive with its anchor: the
    // reference's branch sends the real log position (`forkAt(data.seq)`), and
    // Nova's `WireBlock` carries no seq — so the prop stays unsupplied until a
    // fork operation and its anchor exist. If you are reading this because you
    // just wired `onBranch`, invert these two assertions and add the anchor to
    // `WireBlock` first.
  });

  it('omits the trailing cluster when the tail has neither usage nor clock', () => {
    const bare = renderToStaticMarkup(createElement(MessageIconActions, { text: 'x', clock: 'end' }));
    const withTime = renderToStaticMarkup(createElement(MessageIconActions, {
      text: 'x',
      clock: 'end',
      time: NOON,
    }));
    // The `endInfo` group is an empty box without either slot; the clock adds it.
    expect(withTime.length).toBeGreaterThan(bare.length);
    expect(bare).not.toContain('12:00');
    expect(withTime).toContain('12:00');
  });

  it('stamps the reveal policy the hover rules key on', () => {
    const always = renderToStaticMarkup(createElement(AssistantTailRow, { text: 'a', reveal: 'always' }));
    expect(always).toContain('data-actions-reveal="always"');
    const hover = renderToStaticMarkup(createElement(AssistantTailRow, { text: 'a' }));
    // Default is the conservative one: an earlier turn hides until hover.
    expect(hover).toContain('data-actions-reveal="hover"');
  });
});

describe('local-day clock seat', () => {
  it('drops the date for today and adds it back for an older day', () => {
    // The day seat's own contribution: the reference instant decides whether
    // the label is a bare wall clock or a dated stamp.
    const today = formatClock(new Date(2026, 8, 25, 1, 54).getTime(), NOON);
    expect(today).toBe('01:54');
    const earlier = formatClock(new Date(2026, 8, 24, 1, 54).getTime(), NOON);
    expect(earlier).toContain('01:54');
    expect(earlier).not.toBe(today);
    // Past the year boundary the stamp is unambiguous about the year.
    const lastYear = formatClock(new Date(2025, 8, 24, 1, 54).getTime(), NOON);
    expect(lastYear).toContain('2025');
  });
});

describe('compaction marker', () => {
  it('is a disclosure only when the window still includes the summary', () => {
    const openable = renderToStaticMarkup(createElement(CompactionItem, {
      summary: 'the folded history',
    }));
    expect(openable).toContain('aria-expanded="false"');
    expect(openable).not.toContain('disabled=""');
    // Without a summary the marker is a settled notice, not a control.
    const closed = renderToStaticMarkup(createElement(CompactionItem, {}));
    expect(closed).toContain('disabled=""');
    expect(closed).not.toContain('aria-expanded');
  });

  it('counts what it shadowed and otherwise degrades to the fallback text', () => {
    const counted = renderToStaticMarkup(createElement(CompactionItem, {
      summary: 's',
      shadowed: { items: 12, tokens: 3456 },
    }));
    // The structured counts reach the reader as numbers, not as a raw object.
    expect(counted).toContain('12');
    expect(counted).toContain('3456');
    const fallback = renderToStaticMarkup(createElement(CompactionItem, {
      summary: 's',
      fallbackSummary: '宿主给的结算文案',
    }));
    expect(fallback).toContain('宿主给的结算文案');
  });
});

describe('a prompt that carried images', () => {
  it('draws each attachment from the content-addressed route', () => {
    // The reload path: the transcript carries only a reference, so the row MUST
    // point at the byte route — otherwise the picture is silently gone from a
    // conversation that plainly had one.
    const id = `sha256:${'a'.repeat(64)}`;
    const html = renderToStaticMarkup(createElement(UserMessageRow, {
      text: '看看这张图',
      images: [{ id, mediaType: 'image/png' }],
    }));
    expect(html).toContain(`src="/api/image/${encodeURIComponent(id)}"`);
    expect(html).toContain('看看这张图');
    // The row is marked as carrying attachments, which is what the sheet's
    // `[data-message-attachments]` styling hangs off.
    expect(html).toContain('data-message-attachments');
  });

  it('renders a plain prompt exactly as it did before images existed', () => {
    // No images → no attachment row, no empty wrapper. A text-only prompt must
    // not grow chrome it never had.
    const html = renderToStaticMarkup(createElement(UserMessageRow, { text: 'just text' }));
    expect(html).toContain('just text');
    expect(html).not.toContain('data-message-attachments');
    expect(html).not.toContain('<img');
  });

  it('renders nothing extra for an empty image list', () => {
    // `images: []` is the shape a caller reaches by mapping an empty array; it
    // must be treated as "no attachments", not as an empty row.
    const html = renderToStaticMarkup(createElement(UserMessageRow, { text: 't', images: [] }));
    expect(html).not.toContain('data-message-attachments');
  });
});
