/**
 * Width-aware clipping. All budgets are display columns (CJK counts 2):
 * columns are what the terminal wraps on, not code units.
 *
 * Boundary with `truncateStyled` (packages/tui screen.ts): the clip family
 * here is semantic (per-tool arg style, ellipsis placement chosen by the
 * caller) and runs at build time; `truncateStyled` is the last-resort
 * ANSI-aware safety net at render time. Both stay — neither covers the other.
 */

import { sanitizeForDisplay, styledWidth } from '@nova-agent/tui';
import { isPathArgKind, toolCallKind } from '@nova-agent/core';

/**
 * Last part of `text` that fits maxWidth display columns. The REPL reasoning
 * tail is rewritten in place with `\r\x1b[2K` (exactly one physical row), so
 * an overlong tail would wrap and leave stale garbage above.
 */
export function fitTail(text: string, maxWidth: number): string {
  const chars = [...text];
  let total = 0;
  let start = chars.length;
  while (start > 0) {
    const w = styledWidth(chars[start - 1] ?? '');
    if (total + w > maxWidth) break;
    total += w;
    start -= 1;
  }
  return chars.slice(start).join('');
}

/** Head clip to `maxCols` display columns with a 2-col `…` marker. */
export function clipToWidth(text: string, maxCols: number): string {
  if (maxCols <= 0) return '';
  if (styledWidth(text) <= maxCols) return text;
  let width = 0;
  let out = '';
  for (const ch of text) {
    const w = styledWidth(ch);
    if (width + w > maxCols - 2) return `${out}…`;
    out += ch;
    width += w;
  }
  return out;
}

/**
 * Path clip: the basename is the informative end, so drop from the FRONT
 * (`…\manifest.json`). Walks segment boundaries from the tail so a parent
 * dir is never cut in half; only the innermost kept segment gets trimmed.
 */
export function clipPath(text: string, maxCols: number): string {
  if (maxCols <= 0) return '';
  if (styledWidth(text) <= maxCols) return text;
  const sep = text.includes('\\') ? '\\' : '/';
  const segs = text.split(sep);
  let out = '';
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i] ?? '';
    const cand = out.length === 0 ? seg : `${seg}${sep}${out}`;
    if (styledWidth(`…${cand}`) > maxCols) {
      if (out.length === 0) return `…${fitTail(seg, Math.max(0, maxCols - 2))}`;
      return `…${out}`;
    }
    out = cand;
  }
  return out;
}

/**
 * Command clip: cut at argument boundaries so no token is sliced in half
 * (`… ls -R | ta…` reads as garbage; `… ls -R …` reads as "and more").
 * Falls back to a plain head clip when even the first token overflows.
 */
export function clipCommand(text: string, maxCols: number): string {
  if (maxCols <= 0) return '';
  if (styledWidth(text) <= maxCols) return text;
  const tokens = text.split(/\s+/).filter((t) => t.length > 0);
  let out = '';
  let width = 0;
  for (const tok of tokens) {
    const w = styledWidth(tok) + (out.length === 0 ? 0 : 1);
    if (width + w + 3 > maxCols) break; // keep room for ` …` (space + 2-col ellipsis)
    out = out.length === 0 ? tok : `${out} ${tok}`;
    width += w;
  }
  if (out.length === 0) return clipToWidth(text, maxCols);
  return `${out} …`;
}

/** Pick the clip style by tool semantics, then flatten whitespace. */
function clipArg(name: string, text: string, maxCols: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (name === 'bash') return clipCommand(flat, maxCols);
  // Path-valued tools read as locations, so the tail is the story. Which tools
  // those are comes from the call's semantic kind (core), not a name list here.
  if (isPathArgKind(toolCallKind(name))) return clipPath(flat, maxCols);
  return clipToWidth(flat, maxCols);
}

/**
 * One-glance summary of a tool call's key argument: the file path for fs
 * tools, the command line for bash, action+id for jobs — never raw JSON.
 */
export function toolArgSummary(name: string, rawArgs: string, max = 72): string {
  let args: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(rawArgs);
    if (typeof parsed === 'object' && parsed !== null) args = parsed as Record<string, unknown>;
  } catch {
    // fall through to the raw clip
  }
  if (args !== undefined) {
    const str = (key: string): string | undefined => {
      const v = args?.[key];
      return typeof v === 'string' && v.length > 0 ? v : undefined;
    };
    const keyed =
      (name === 'search_files' ? str('content_regex') ?? str('name_glob') : undefined) ??
      str('path') ??
      str('command') ??
      str('name') ??
      (name === 'jobs'
        ? [str('action'), str('id')].filter((s) => s !== undefined).join(' ') || undefined
        : undefined) ??
      (name === 'todo_write' && Array.isArray(args['todos']) ? `${args['todos'].length} 项待办` : undefined) ??
      Object.values(args).find((v): v is string => typeof v === 'string' && v.length > 0);
    if (keyed !== undefined && keyed.length > 0) return sanitizeForDisplay(clipArg(name, keyed, max));
  }
  return sanitizeForDisplay(clipArg(name, rawArgs, max));
}
