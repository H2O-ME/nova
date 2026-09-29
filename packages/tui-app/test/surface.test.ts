/**
 * The terminal-UI surface plugin's claim rule — the argv + stdio shape that
 * `nova --tui` answers. This used to live in the cli's surface registry; it now
 * lives HERE (the plugin), so adding or replacing the TUI is a config row, not
 * a source change to the cli.
 *
 * The rule is unchanged from the cli's old entry, pinned there by
 * `cli/test/surfaces.test.ts`: forced (`--tui`), interactive only (needs a TTY
 * on both ends — a raw-mode frame has nowhere to draw down a pipe), and yields
 * to `--repl` (force-fallback is stronger than "full-screen please"). Asserting
 * it here keeps the plugin honest about the contract it advertises.
 */
import type { AgentSurfaceFlags, AgentSurfaceRequest } from '@nova-agent/core';
import { describe, expect, it } from 'vitest';
import { tuiSurface } from '../src/surface.js';

function request(flags: Partial<AgentSurfaceFlags>, interactive = true): AgentSurfaceRequest {
  return {
    rootDir: '/repo',
    argv: [],
    interactive,
    flags: {
      json: false,
      repl: false,
      web: false,
      tui: false,
      positional: [],
      ...flags,
    },
  };
}

describe('tuiSurface.claim', () => {
  it('claims an explicit --tui on an interactive invocation', () => {
    expect(tuiSurface.claim(request({ tui: true }))).toBe(true);
  });

  it('is forced (needs the flag, not just a TTY)', () => {
    // A bare `nova` on a terminal must still go to the browser default — the
    // TUI is an explicit opt-in, not the default product surface.
    expect(tuiSurface.claim(request({}, true))).toBe(false);
  });

  it('never claims without a TTY on both ends', () => {
    // A raw-mode frame down a pipe has nowhere to draw and no keys to read, so
    // `--tui` must degrade rather than corrupt the stream. Same posture as the
    // browser surface, which needs a browser to render in.
    expect(tuiSurface.claim(request({ tui: true }, false))).toBe(false);
  });

  it('yields to --repl (force-fallback is stronger than full-screen)', () => {
    expect(tuiSurface.claim(request({ tui: true, repl: true }))).toBe(false);
    expect(tuiSurface.claim(request({ repl: true, tui: true }))).toBe(false);
  });

  it('keeps --tui alongside other interactive flags', () => {
    // The host owns resume/approval/theme; the TUI inherits them like every
    // interactive surface — the claim must not reject a resume or a theme.
    expect(tuiSurface.claim(request({ tui: true, theme: 'dark' }))).toBe(true);
  });

  it('declares itself interactive and able to answer questions', () => {
    // The host derives `userQuestions` from this — a surface with a person opts
    // in exactly once, here, not via a hand-copied line at every assembly site.
    expect(tuiSurface.interactive).toBe(true);
    expect(tuiSurface.answersQuestions).toBe(true);
  });
});
