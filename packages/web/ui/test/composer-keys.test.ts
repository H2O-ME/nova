/**
 * The composer's key contract, asserted against the harness keymap's decision
 * order. Every case here corresponds to a way a naive `onKeyDown` handler gets
 * it wrong: sending a half-typed Chinese word on the Enter that was meant to
 * pick an IME candidate, breaking the line on a composition-closing
 * Shift+Enter, raining newlines out of a held Enter, submitting into a locked
 * bar, or claiming an Escape that belongs to an overlay.
 */
import { describe, expect, it } from 'vitest';
import { COMPOSING_GRACE_MS, composerKey, composing, type ComposerKeyEvent } from '../src/composer-keys.js';

const key = (over: Partial<ComposerKeyEvent> = {}): ComposerKeyEvent => ({
  key: 'Enter',
  shiftKey: false,
  repeat: false,
  ...over,
});

describe('composerKey', () => {
  it('Enter submits', () => {
    expect(composerKey(key())).toBe('submit');
    expect(composerKey(key({ keyCode: 13 }))).toBe('submit');
  });

  it('Shift+Enter is a line break, decided before the IME guard', () => {
    expect(composerKey(key({ shiftKey: true }))).toBe('default');
    // A composition-closing Shift+Enter still breaks the line.
    expect(composerKey(key({ shiftKey: true, isComposing: true }))).toBe('default');
  });

  it('never claims a keydown that belongs to the IME', () => {
    expect(composerKey(key({ isComposing: true }))).toBe('default');
    expect(composerKey(key({ keyCode: 229 }))).toBe('default');
    // Safari: the closing keydown arrives a tick after compositionend.
    expect(composerKey(key({ recentlyComposing: true }))).toBe('default');
  });

  it('Escape closes an open overlay and is otherwise left alone', () => {
    expect(composerKey(key({ key: 'Escape', overlayOpen: true }))).toBe('dismiss');
    // The harness has no abort chord: with no overlay, Escape is not ours.
    expect(composerKey(key({ key: 'Escape' }))).toBe('default');
    // Cancelling an IME candidate must not close anything.
    expect(composerKey(key({ key: 'Escape', isComposing: true, overlayOpen: true }))).toBe('default');
  });

  it('swallows a held Enter instead of raining newlines', () => {
    expect(composerKey(key({ repeat: true }))).toBe('consume');
  });

  it('refuses the gesture on a locked or busy bar, without a newline', () => {
    expect(composerKey(key({ canSubmit: false }))).toBe('consume');
    // The lock outranks the repeat only in cost, not in outcome.
    expect(composerKey(key({ canSubmit: false, repeat: true }))).toBe('consume');
  });

  it('leaves every other key to the textarea', () => {
    expect(composerKey(key({ key: 'a' }))).toBe('default');
    expect(composerKey(key({ key: 'ArrowUp' }))).toBe('default');
    expect(composerKey(key({ key: 'Tab' }))).toBe('default');
  });
});

describe('composing', () => {
  it('is true for the native flag, the legacy keyCode, and the grace window', () => {
    expect(composing({ key: 'Enter', shiftKey: false, repeat: false, isComposing: true })).toBe(true);
    expect(composing({ key: 'Enter', shiftKey: false, repeat: false, keyCode: 229 })).toBe(true);
    expect(composing({ key: 'Enter', shiftKey: false, repeat: false, recentlyComposing: true })).toBe(true);
    expect(composing({ key: 'Enter', shiftKey: false, repeat: false })).toBe(false);
  });

  it('keeps the grace window short enough to be invisible', () => {
    expect(COMPOSING_GRACE_MS).toBeLessThanOrEqual(20);
  });
});