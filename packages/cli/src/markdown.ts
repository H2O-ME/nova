import type { Palette } from './ui.js';

/**
 * Minimal markdown-to-ANSI rendering for assistant replies: bold, inline
 * code, headings, bullets and fenced code blocks. Everything else passes
 * through untouched — the goal is removing raw markdown symbols from the
 * screen, not full document rendering.
 */

/**
 * Shared per-line renderer. `state.inFence` carries across lines; a
 * fence-marker line produces no output (undefined). `commit=false`
 * re-renders a still-unfinished trailing line without mutating fence state —
 * the line is re-processed for real once its newline arrives.
 */
function renderLine(raw: string, state: { inFence: boolean }, p: Palette, commit = true): string | undefined {
  const line = raw.replace(/\s+$/, '');
  if (/^\s*```/.test(line)) {
    if (commit) state.inFence = !state.inFence;
    return undefined;
  }
  if (state.inFence) return p.dim(line);
  const heading = line.match(/^#{1,6}\s+(.*)$/);
  if (heading !== null) return p.bold(p.cyan(heading[1] ?? ''));
  const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
  if (bullet !== null) {
    return `${bullet[1]}· ${renderInline(bullet[2] ?? '', p)}`;
  }
  return renderInline(line, p);
}

function renderInline(text: string, p: Palette): string {
  return text
    // code spans first so their content keeps the code color
    .replace(/`([^`]+)`/g, (_, code: string) => p.cyan(code))
    .replace(/\*\*([^*]+)\*\*/g, (_, bold: string) => p.bold(bold));
}

export function renderMarkdownLite(text: string, p: Palette): string[] {
  const state = { inFence: false };
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = renderLine(raw, state, p);
    if (line !== undefined) out.push(line);
  }
  return out;
}

/**
 * Incremental streaming renderer: complete lines are rendered once and
 * cached; only the trailing (still-unfinished) line is re-rendered per push.
 * Replaces the old whole-text re-render on every delta, which made long
 * replies progressively laggy.
 */
export interface MarkdownRenderer {
  push(text: string): string[];
}

export function createMarkdownRenderer(p: Palette): MarkdownRenderer {
  const state = { inFence: false };
  const done: string[] = [];
  let pending = '';
  return {
    push(text: string): string[] {
      pending += text;
      let newlineIdx = pending.indexOf('\n');
      while (newlineIdx >= 0) {
        const line = renderLine(pending.slice(0, newlineIdx), state, p);
        if (line !== undefined) done.push(line);
        pending = pending.slice(newlineIdx + 1);
        newlineIdx = pending.indexOf('\n');
      }
      if (pending.length === 0) return [...done];
      const tail = renderLine(pending, state, p, false);
      return tail !== undefined ? [...done, tail] : [...done];
    },
  };
}
