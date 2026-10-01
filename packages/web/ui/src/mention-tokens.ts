/**
 * Reference mentions as DISPLAY tokens — the harness `ui-primitives/user-text.tsx`
 * `projectUserText` reduced to what this surface has: file and folder mentions
 * in `@path` / `@"path with spaces"` form.
 *
 * Two consumers share this one rule, on purpose: the transcript turns a sent
 * prompt's mentions into chips, and the composer mirrors the live draft under
 * its textarea so a mention reads as the same chip while it is being written.
 * The text itself is untouched either way — presentation only, so
 * "model-visible means logged" keeps holding with no log change.
 *
 * The token shape is the grammar the composer already writes
 * (`reference-menu.ts`): an `@` at the start or after whitespace, a bare token
 * ending at whitespace, `@"…"` carrying whitespace inside; a bare token sheds
 * trailing sentence punctuation (`@src/x。` names `src/x`), which the harness
 * does too (`TRAILING_PUNCTUATION_RE`).
 */

/** One slice of the text: plain prose, or a mention worth dressing up. */
export type MentionSegment =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'file' | 'folder';
      /** The mention exactly as written (`@src/x.ts`), for the row's title. */
      readonly raw: string;
      /** The path inside the token, quotes stripped, no trailing slash. */
      readonly path: string;
      /** The last path segment — what the chip shows. */
      readonly label: string;
    };

/** Sentence punctuation a bare token may carry without it being part of the path. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/u;

/**
 * CJK sentence punctuation a bare token STOPS at.
 *
 * The harness pattern is `@[^\s]+` with trailing punctuation shed, which is
 * right for its atomic chips: a chip is inserted as one unit, so text glued
 * after it is unusual. Our mentions are ordinary typed text, and Chinese
 * prose carries no spaces — `@src/main.ts，然后看这个` would take the whole
 * clause into the path. These characters cannot occur inside a path the
 * composer can write un-quoted, so cutting at them is safe; a path that
 * genuinely needs one is quoted (`@"…"`), which this rule does not touch.
 */
const BARE_TOKEN_STOP = '，。；：！？、（）【】「」《》〈〉…';

/**
 * Split one text into plain runs and mention tokens.
 * @param text - the draft or the sent prompt, verbatim.
 * @returns segments covering the whole text, in order.
 */
export function mentionSegments(text: string): readonly MentionSegment[] {
  const pattern = new RegExp(`(^|\\s)(@"[^"\\n]+"|@[^\\s${BARE_TOKEN_STOP}]+)`, 'gu');
  const segments: MentionSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[2] ?? '';
    // `length <= 1` is a bare `@` with nothing after it: the trigger itself,
    // not a mention (the harness skips it the same way).
    const token = raw.startsWith('@"') ? raw : raw.replace(TRAILING_PUNCTUATION, '');
    if (token.length <= 1) continue;
    const start = match.index + (match[1] ?? '').length;
    if (start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, start) });
    const path = token.startsWith('@"') ? token.slice(2, -1) : token.slice(1);
    const label = path.split('/').filter((segment) => segment !== '').at(-1) ?? path;
    segments.push({
      kind: path.endsWith('/') ? 'folder' : 'file',
      raw: token,
      path,
      label,
    });
    cursor = start + token.length;
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}
