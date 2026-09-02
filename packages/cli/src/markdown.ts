import type { Palette } from './ui.js';

/**
 * Minimal markdown-to-ANSI rendering for assistant replies: bold, inline
 * code, headings, bullets and fenced code blocks. Everything else passes
 * through untouched — the goal is removing raw markdown symbols from the
 * screen, not full document rendering.
 */
export function renderMarkdownLite(text: string, p: Palette): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(p.dim(line));
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading !== null) {
      out.push(p.bold(heading[1] ?? ''));
      continue;
    }
    const bullet = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (bullet !== null) {
      out.push(`${bullet[1]}· ${renderInline(bullet[2] ?? '', p)}`);
      continue;
    }
    out.push(renderInline(line, p));
  }
  return out;
}

function renderInline(text: string, p: Palette): string {
  return text
    // code spans first so their content keeps the code color
    .replace(/`([^`]+)`/g, (_, code: string) => p.cyan(code))
    .replace(/\*\*([^*]+)\*\*/g, (_, bold: string) => p.bold(bold));
}
