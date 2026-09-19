/**
 * The turn row's contract: it exists only while a turn runs, its timer reads
 * the way grok's does at each scale, and "working" and "waiting for you" look
 * different. Those three are the whole point of the row.
 */
import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { buildPalette, plainPalette } from '../src/theme.js';
import {
  SPINNER_DIVISOR,
  formatDuration,
  formatTokensShort,
  phaseWord,
  pulseFrame,
  spinnerFrame,
  turnStatusLine,
  type TurnStatusInput,
} from '../src/turn-status.js';

const palette = plainPalette();
const base = (over: Partial<TurnStatusInput> = {}): TurnStatusInput => ({
  cols: 80,
  tick: 0,
  phase: 'thinking',
  startedAt: 1_000,
  now: 3_400,
  queued: 0,
  ...over,
});

describe('the timer', () => {
  it('gives one decimal under ten seconds, whole seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0.0s');
    expect(formatDuration(400)).toBe('0.4s');
    expect(formatDuration(9_949)).toBe('9.9s');
    expect(formatDuration(10_000)).toBe('10s');
    expect(formatDuration(59_400)).toBe('59s');
  });

  it('switches to minutes and hours as the turn grows', () => {
    expect(formatDuration(60_000)).toBe('1m0s');
    expect(formatDuration(3_540_000)).toBe('59m0s');
    expect(formatDuration(3_720_000)).toBe('1h2m');
  });

  it('never goes backwards below zero', () => {
    expect(formatDuration(-500)).toBe('0.0s');
  });
});

describe('the spinner', () => {
  it('advances one frame every four ticks', () => {
    expect(spinnerFrame(0)).toBe('⠋');
    expect(spinnerFrame(SPINNER_DIVISOR - 1)).toBe('⠋');
    expect(spinnerFrame(SPINNER_DIVISOR)).toBe('⠙');
    expect(spinnerFrame(SPINNER_DIVISOR * 8)).toBe('⠋'); // wraps
  });

  it('has a slower pulse for "nothing is being generated"', () => {
    expect(pulseFrame(0)).toBe('○');
    expect(pulseFrame(8)).toBe('◎');
  });
});

describe('the row', () => {
  it('is absent while idle, present while a turn runs', () => {
    expect(turnStatusLine(base({ phase: 'idle', startedAt: undefined }), palette)).toBe('');
    expect(turnStatusLine(base(), palette)).toContain('思考中');
  });

  it('names the phase in the surface’s own words', () => {
    for (const phase of ['thinking', 'writing', 'tool', 'waiting_approval', 'compacting', 'retrying'] as const) {
      expect(turnStatusLine(base({ phase }), palette)).toContain(phaseWord(phase));
    }
  });

  it('pulses a diamond instead of spinning when a tool is waiting for the user', () => {
    const line = turnStatusLine(base({ phase: 'waiting_approval', blockedOnUser: true }), palette);
    expect(line).toContain('◆');
    expect(line).not.toContain('⠋');
  });

  it('shows the elapsed time and the queue depth', () => {
    const line = turnStatusLine(base({ queued: 2 }), palette);
    expect(line).toContain('2.4s');
    expect(line).toContain('⧉2');
  });

  it('reports the last request’s prompt tokens when known', () => {
    expect(turnStatusLine(base({ promptTokens: 12_500 }), palette)).toContain('⇣12.5k');
    expect(turnStatusLine(base(), palette)).not.toContain('⇣');
  });

  it('keeps the timer at the right edge of the width it was given', () => {
    const line = turnStatusLine(base({ cols: 40 }), palette);
    expect(line.length).toBeLessThanOrEqual(40);
    expect(line.trimEnd()).toContain('2.4s');
  });
});

describe('a colour terminal', () => {
  const color = buildPalette({ color: true, truecolor: true });

  it('still aims the timer at the right edge', () => {
    const line = turnStatusLine(base({ cols: 40 }), color);
    expect(styledWidth(line)).toBe(39);
    expect(line.length).toBeGreaterThan(39);
  });
});

describe('formatTokensShort', () => {
  it('follows grok’s tiers', () => {
    expect(formatTokensShort(999)).toBe('999');
    expect(formatTokensShort(1_500)).toBe('1.50k');
    expect(formatTokensShort(12_500)).toBe('12.5k');
    expect(formatTokensShort(125_000)).toBe('125k');
    expect(formatTokensShort(2_500_000)).toBe('2.50m');
  });
});