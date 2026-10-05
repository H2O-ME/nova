/**
 * The composer's copy and its two decisions: what the primary seat is (send or
 * stop, enabled or not, and the label that names what a click delivers) and
 * what the queue strip shows. The wording is pinned by value because it is the
 * harness's own zh dictionary — a re-worded string here is a divergence from
 * the reference, not a style change.
 */
import { describe, expect, it } from 'vitest';
import {
  COMMANDS_LABEL, PLACEHOLDER_DEFAULT, PLACEHOLDER_HERO, PLACEHOLDER_UNAVAILABLE, QUEUE_SEND_LABEL,
  SEND_LABEL, STILL_UPLOADING, STOP_LABEL, placeholderFor, plainDraft, primarySeat, queueCountLabel,
  queueHeaderVisible, queueListVisible, queuePreview, sendGate,
} from '../src/composer/composer-text.js';

describe('placeholderFor', () => {
  it('names the session as unavailable while the bar is locked', () => {
    expect(placeholderFor({ disabled: true })).toBe(PLACEHOLDER_UNAVAILABLE);
  });

  it('distinguishes the docked card from the hero', () => {
    expect(placeholderFor({ disabled: false })).toBe(PLACEHOLDER_DEFAULT);
    expect(placeholderFor({ disabled: false, hero: true })).toBe(PLACEHOLDER_HERO);
  });

  it('lets the owner override win, disabled or not', () => {
    expect(placeholderFor({ disabled: true, override: '父会话已离线' })).toBe('父会话已离线');
    expect(placeholderFor({ disabled: false, override: '' })).toBe('');
  });
});

describe('plainDraft', () => {
  it('is false for an empty draft and for a slash line', () => {
    expect(plainDraft('')).toBe(false);
    expect(plainDraft('   \n ')).toBe(false);
    expect(plainDraft('/compact')).toBe(false);
    expect(plainDraft('   /compact')).toBe(false);
  });

  it('is true for an ordinary message, slashes included after the first character', () => {
    expect(plainDraft('跑一下测试')).toBe(true);
    expect(plainDraft('src/a/b.ts 的 / 分隔符')).toBe(true);
  });
});

describe('primarySeat', () => {
  it('is Send over an empty idle bar, disabled', () => {
    expect(primarySeat({ running: false, disabled: false, draft: '' })).toEqual({
      kind: 'send', disabled: true, label: SEND_LABEL,
    });
  });

  it('is Send and enabled over a draft', () => {
    expect(primarySeat({ running: false, disabled: false, draft: '跑测试' })).toEqual({
      kind: 'send', disabled: false, label: SEND_LABEL,
    });
  });

  it('turns into Stop while a run holds an empty draft, even when the bar is locked', () => {
    // The abort control is never a trap: an approval pending means locked AND
    // running, and this seat is the way out of it.
    expect(primarySeat({ running: true, disabled: false, draft: '' })).toEqual({
      kind: 'stop', disabled: false, label: STOP_LABEL,
    });
    expect(primarySeat({ running: true, disabled: true, draft: '   ' })).toEqual({
      kind: 'stop', disabled: false, label: STOP_LABEL,
    });
  });

  it('names the busy delivery for what it does: the draft queues', () => {
    expect(primarySeat({ running: true, disabled: false, draft: '再跑一次' })).toEqual({
      kind: 'send', disabled: false, label: QUEUE_SEND_LABEL,
    });
  });

  it('keeps the plain label for a busy slash line and for a locked bar', () => {
    expect(primarySeat({ running: true, disabled: false, draft: '/session' }).label).toBe(SEND_LABEL);
    expect(primarySeat({ running: true, disabled: true, draft: '再跑一次' })).toEqual({
      kind: 'send', disabled: true, label: SEND_LABEL,
    });
  });

  it('refuses to send while an attachment is still uploading, and says why', () => {
    // The regression this pins: `submit()` sent unconditionally, so Enter during
    // an upload delivered a prompt that named a file not yet on disk. dsh refuses
    // for exactly this reason (`view-binding.ts:128`).
    expect(primarySeat({ running: false, disabled: false, draft: '看看这个', uploading: true })).toEqual({
      kind: 'send', disabled: true, label: STILL_UPLOADING,
    });
    // Stop still wins over the upload guard when the draft is empty: a run in
    // flight must stay interruptible regardless of what the rail is doing.
    expect(primarySeat({ running: true, disabled: false, draft: '', uploading: true }).kind).toBe('stop');
  });

  it('sends normally again once the upload settles', () => {
    expect(primarySeat({ running: false, disabled: false, draft: '看看这个', uploading: false })).toEqual({
      kind: 'send', disabled: false, label: SEND_LABEL,
    });
    // Absent is the same as false, so existing callers are unaffected.
    expect(primarySeat({ running: false, disabled: false, draft: '看看这个' }).disabled).toBe(false);
  });
});

describe('the queue strip', () => {
  it('writes the count the harness dictionary writes', () => {
    expect(queueCountLabel(1)).toBe('1 条排队消息');
    expect(queueCountLabel(3)).toBe('3 条排队消息');
    expect(COMMANDS_LABEL).toBe('添加文件或调用指令');
  });

  it('collapses a queued prompt to one line for the ellipsized preview', () => {
    expect(queuePreview('第一行\n第二行')).toBe('第一行 第二行');
    expect(queuePreview('  空格\t与\t制表  ')).toBe('空格 与 制表');
    expect(queuePreview('\n\n')).toBe('');
  });

  it('shows the count header only above one row', () => {
    expect(queueHeaderVisible(1)).toBe(false);
    expect(queueHeaderVisible(2)).toBe(true);
  });

  it('shows a single row always, and a longer strip only when opened', () => {
    expect(queueListVisible(1, true)).toBe(true);
    expect(queueListVisible(3, true)).toBe(false);
    expect(queueListVisible(3, false)).toBe(true);
  });
});
describe('sendGate', () => {
  // One verdict, two readers: the seat's disabled state and submit()'s early
  // return. They once disagreed while an image was uploading (the seat was fed
  // a hard-coded `uploading: false`), so the verdict itself is pinned here —
  // whoever reintroduces a second computation of "can I send" breaks against
  // this, not against the user.
  it('refuses an empty draft with no ready image', () => {
    expect(sendGate({ draft: '', readyImages: 0, uploadingImages: 0 })).toEqual({ ok: false, why: 'empty' });
    expect(sendGate({ draft: '   \n', readyImages: 0, uploadingImages: 0 })).toEqual({ ok: false, why: 'empty' });
  });

  it('counts a ready image as content: an image-only prompt is legitimate', () => {
    expect(sendGate({ draft: '', readyImages: 1, uploadingImages: 0 })).toEqual({ ok: true });
  });

  it('refuses while any body is still uploading, even with text', () => {
    expect(sendGate({ draft: '看看这个', readyImages: 0, uploadingImages: 1 })).toEqual({ ok: false, why: 'uploading' });
    // A mixed batch refuses on UPLOADING: the prompt would name a file that
    // does not exist yet.
    expect(sendGate({ draft: '看看这个', readyImages: 2, uploadingImages: 1 })).toEqual({ ok: false, why: 'uploading' });
  });

  it('allows plain text with nothing in flight', () => {
    expect(sendGate({ draft: '看看这个', readyImages: 0, uploadingImages: 0 })).toEqual({ ok: true });
  });
});
