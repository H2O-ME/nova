/**
 * The draft's height contract: the cap the harness draws (14 lines × 24px =
 * 336px) and the height the auto-grow writes back. Two things this pins:
 * the cap is the scrollport's single value (the sheet's
 * `--dsh-composer-text-max-height` — the surface itself is NOT clamped, or a
 * long draft would be clipped instead of scrolled), and a measurement that is
 * not a number never reaches the inline style (a literal `NaN` leaves the
 * previous draft's height in place instead of collapsing the box).
 */
import { describe, expect, it } from 'vitest';
import {
  MENU_MARGIN, MENU_MAX_HEIGHT, TEXT_LINE_HEIGHT_PX, TEXT_MAX_LINES, TEXT_MAX_PX, TEXT_MIN_PX,
  chainsWheelToConversation, composerSurfaceHeight, menuMaxHeight, menuOverflowBelow,
} from '../src/composer/composer-measure.js';

describe('the draft cap', () => {
  it('is 14 lines of the 24px line, the number the sheet uses', () => {
    expect(TEXT_MAX_LINES).toBe(14);
    expect(TEXT_LINE_HEIGHT_PX).toBe(24);
    expect(TEXT_MAX_PX).toBe(336);
    expect(TEXT_MAX_PX).toBe(TEXT_MAX_LINES * TEXT_LINE_HEIGHT_PX);
  });

  it('floors a docked draft at one line plus its top pad', () => {
    expect(TEXT_MIN_PX).toBe(36);
    expect(TEXT_MIN_PX).toBe(TEXT_LINE_HEIGHT_PX + 4 + 8);
  });
});

describe('composerSurfaceHeight', () => {
  it('passes a measured draft through unchanged', () => {
    expect(composerSurfaceHeight(48)).toBe(48);
    expect(composerSurfaceHeight(0)).toBe(0);
  });

  it('does NOT clamp a long draft: the scrollport owns the cap', () => {
    expect(composerSurfaceHeight(TEXT_MAX_PX + 1)).toBe(TEXT_MAX_PX + 1);
    expect(composerSurfaceHeight(1200)).toBe(1200);
  });

  it('falls back to the floor on a measurement that is not a number', () => {
    expect(composerSurfaceHeight(Number.NaN)).toBe(TEXT_MIN_PX);
    // A non-finite measurement is no measurement: the floor is the only honest
    // height to draw (a huge box would invent a draft the surface never
    // reported, and would push the toolbar off the card).
    expect(composerSurfaceHeight(Number.POSITIVE_INFINITY)).toBe(TEXT_MIN_PX);
    expect(composerSurfaceHeight(Number.NEGATIVE_INFINITY)).toBe(TEXT_MIN_PX);
  });
});

describe('chainsWheelToConversation', () => {
  // A 336px-capped draft inside a 100px-tall scrollport holding 336px of text.
  const box = { scrollTop: 0, clientHeight: 100, scrollHeight: 336 };

  it('keeps the native scroll while the draft can still move that way', () => {
    expect(chainsWheelToConversation({ ...box, deltaY: 40 })).toBe(false);
    expect(chainsWheelToConversation({ ...box, deltaY: -40, scrollTop: 120 })).toBe(false);
  });

  it('forwards the delta at the draft scrollport own edge', () => {
    expect(chainsWheelToConversation({ ...box, deltaY: 40, scrollTop: 236 })).toBe(true);
    expect(chainsWheelToConversation({ ...box, deltaY: -40, scrollTop: 0 })).toBe(true);
  });

  it('does not trap a short draft: it is always at both edges at once', () => {
    const short = { scrollTop: 0, clientHeight: 100, scrollHeight: 36 };
    expect(chainsWheelToConversation({ ...short, deltaY: 40 })).toBe(true);
    expect(chainsWheelToConversation({ ...short, deltaY: -40 })).toBe(true);
  });

  it('leaves a horizontal-only gesture alone', () => {
    expect(chainsWheelToConversation({ ...box, deltaY: 0, scrollTop: 236 })).toBe(false);
  });
});

describe('menuMaxHeight', () => {
  it('never exceeds the design cap', () => {
    expect(menuMaxHeight(2000)).toBe(MENU_MAX_HEIGHT);
    expect(MENU_MAX_HEIGHT).toBe(400);
  });

  it('clamps to the space above the overlay, keeping clearance for the header', () => {
    // 84px = the conversation header's 76px block plus 8px of air, which is the
    // harness `MenuView`'s `TOP_MARGIN` for this seat. The trigger menu is
    // absolutely positioned, so a long list grows UP over the header rather than
    // being pushed down by it — a 12px margin painted the rows on top of it.
    expect(MENU_MARGIN).toBe(84);
    expect(menuMaxHeight(300)).toBe(216);
    // A viewport with no room left yields zero, not a negative height.
    expect(menuMaxHeight(4)).toBe(0);
    expect(menuMaxHeight(-100)).toBe(0);
  });

  it('falls back to the cap when the overlay was never laid out', () => {
    expect(menuMaxHeight(Number.NaN)).toBe(MENU_MAX_HEIGHT);
  });
});

describe('menuOverflowBelow', () => {
  it('is true while rows remain below the fold', () => {
    expect(menuOverflowBelow(0, 300, 800)).toBe(true);
    expect(menuOverflowBelow(400, 300, 800)).toBe(true);
  });

  it('is false at the end, and for a list that fits', () => {
    expect(menuOverflowBelow(500, 300, 800)).toBe(false);
    expect(menuOverflowBelow(0, 300, 300)).toBe(false);
  });
});