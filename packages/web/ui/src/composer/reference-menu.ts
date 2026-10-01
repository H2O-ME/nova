/**
 * The `@` reference menu's decisions, as pure functions — the file half of what
 * `command-menu.ts` does for `/`.
 *
 * A reference is TEXT, not a protocol object. The harness inserts an atomic
 * chip whose serialized form is the natural `@path` token; this surface has no
 * rich editor, so a pick writes that same token into the draft and the model
 * reads the file with the tool it already has. That is why nothing here talks
 * to a new model-visible channel: the mention is exactly the text a user could
 * have typed, which keeps "model-visible means logged" true with no log change.
 *
 * The grammar is the harness's `file-reference/grammar.ts` (`activeAtToken` /
 * `formatFileMention`), re-expressed over a plain textarea: a token is live
 * only when it ends at the CARET, it opens at the draft's start or after
 * whitespace (so an email address is prose), a bare token ends at the first
 * whitespace, and `@"…"` carries whitespace inside it.
 */
import type { WireFileEntry } from '../types.js';
import { REFERENCE_SECTION } from './composer-text.js';
import type { ComposerMenuItem } from './ComposerMenu.js';

/**
 * The `@` query ending at the caret, or null when the caret is not in one.
 *
 * Two anchored patterns, in the reference's order: an OPEN quoted token first
 * (it may span whitespace), then a bare one. Both require the `@` to sit at the
 * draft's start or after whitespace — an `@` inside another token, such as an
 * email address, is not a completion trigger — and both are anchored to the
 * end of the text before the caret, so a caret moved off the token closes the
 * menu rather than filtering on a mention nobody is editing. A newline is
 * whitespace, so a token never survives to the next line.
 * @param draft - the full draft text.
 * @param caret - the caret offset into `draft` (defaults to its end).
 * @returns the query, or null when no reference is live.
 */
export function atQuery(draft: string, caret: number = draft.length): string | null {
  const before = draft.slice(0, Math.max(0, Math.min(caret, draft.length)));
  const quoted = /(?:^|\s)@"([^"]*)$/u.exec(before);
  if (quoted?.[1] !== undefined) return quoted[1];
  const plain = /(?:^|\s)@([^\s]*)$/u.exec(before);
  return plain?.[1] ?? null;
}

/** The span one `@` token occupies: `[start, end)` in the draft. */
export interface MentionSpan {
  start: number;
  end: number;
  /** The text after `@` (or after the opening quote). */
  query: string;
}

/**
 * The live `@` token's span, for a pick to replace in place.
 *
 * `atQuery` answers "is a reference live"; this answers "where does it end",
 * which is what lets a pick rewrite the token the caret is in rather than the
 * draft's tail.
 * @param draft - the full draft text.
 * @param caret - the caret offset into `draft`.
 * @returns the span, or null when no reference is live.
 */
export function atSpan(draft: string, caret: number = draft.length): MentionSpan | null {
  const end = Math.max(0, Math.min(caret, draft.length));
  const query = atQuery(draft, end);
  if (query === null) return null;
  // The prefix is `@` plus, for a quoted token, its opening quote.
  const quotedOpen = draft.slice(0, end).endsWith(`@"${query}`);
  return { start: end - query.length - (quotedOpen ? 2 : 1), end, query };
}

/**
 * What one pick writes into the draft: the live `@` token replaced by the
 * canonical mention.
 *
 * A FILE pick appends a trailing space so the next token starts cleanly. A
 * DIRECTORY pick does NOT: it leaves the token live (`@src/`) so the menu can
 * descend another level from the caret. Appending a space there would end the
 * token, which is why a directory pick used to be unable to drill even in
 * principle.
 *
 * A path the grammar cannot represent leaves the draft exactly as it was —
 * writing a token that would parse back as a DIFFERENT path is worse than
 * writing nothing, because the model would then read the wrong file.
 * @param draft - the full draft text.
 * @param path - the picked workspace-relative path.
 * @param trailingSlash - the pick is a directory, which descends further.
 * @param caret - the caret offset into `draft`.
 * @returns the next draft.
 */
export function referenceDraft(
  draft: string,
  path: string,
  trailingSlash = false,
  caret: number = draft.length,
): string {
  const span = atSpan(draft, caret);
  if (span === null) return draft;
  const mention = formatMention(path, trailingSlash);
  if (mention === null) return draft;
  const tail = trailingSlash ? '' : ' ';
  return `${draft.slice(0, span.start)}${mention}${tail}${draft.slice(span.end)}`;
}

/**
 * The mention token for one path: bare when it is a single unbroken word,
 * quoted when it carries whitespace or a quote.
 *
 * A DIRECTORY is the special case, and it is what makes drill-down possible: the
 * token keeps its quote OPEN after the trailing slash (port of the harness
 * `formatFileMention`, which returns `@"path/`). Closing it would terminate the
 * token, so the next keystroke would start a new word and the menu could never
 * descend a level — the pick would be born dead.
 *
 * `null` means the path cannot be written in this grammar at all: a control
 * character or a `"` cannot be escaped in it, and stripping one would name a
 * different file. The reference refuses the same inputs (`formatFileMention`).
 * @param path - the workspace-relative path to mention, WITHOUT a trailing slash.
 * @param directory - the path names a directory, so its quote stays open.
 * @returns the token, or null when the grammar cannot represent the path.
 */
export function formatMention(path: string, directory = false): string | null {
  // oxlint-disable-next-line no-control-regex -- control characters are exactly what a mention token cannot carry
  if (/[\u0000-\u001f\u007f-\u009f"]/u.test(path)) return null;
  const withSlash = directory ? `${path}/` : path;
  if (!/\s/u.test(withSlash)) return `@${withSlash}`;
  // A quoted directory leaves its quote OPEN so completion can continue.
  return directory ? `@"${withSlash}` : `@"${withSlash}"`;
}

/**
 * The menu's rows for one listing.
 *
 * Directories before files, the harness listing's visible order (its
 * `kindRank` tie-break): a directory listing reads like a file explorer, and
 * within each kind the host's order stands — alphabetical for a directory
 * listing, shallow-first for a workspace walk.
 * @param entries - the host's listing for the current query.
 * @param withLocation - the row names its parent directory. A drilled
 *   listing's breadcrumb header already carries the directory, so its rows
 *   repeat nothing (`withLocation: false`); every other listing has no header.
 * @returns the rows, directories first.
 */
export function referenceItems(
  entries: readonly WireFileEntry[],
  withLocation = true,
): ComposerMenuItem[] {
  const dirs = entries.filter((entry) => entry.kind === 'directory');
  const files = entries.filter((entry) => entry.kind === 'file');
  return [...dirs, ...files].map((entry) => {
    const slash = entry.path.lastIndexOf('/');
    const parent = slash < 0 ? '' : entry.path.slice(0, slash);
    return {
      id: entry.path,
      label: entry.kind === 'directory' ? `${entry.name}/` : entry.name,
      // The parent directory is the useful disambiguator; a root entry has
      // none to name, and repeating the row's own label says nothing.
      ...(parent !== '' && withLocation ? { description: parent } : {}),
      icon: entry.kind === 'directory' ? 'folder' : 'file',
      section: REFERENCE_SECTION,
      ...(entry.kind === 'directory' ? { drill: true } : {}),
    };
  });
}
