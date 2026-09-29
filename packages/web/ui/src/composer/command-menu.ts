/**
 * The `/` menu's decisions, as pure functions: when it opens, what it lists for
 * the text typed so far, what a pick writes into the draft, and — the one that
 * matters — what a submitted draft MEANS (a command frame or a prompt).
 *
 * Split from `InputBar` for the usual reason: these are the rules a reader would
 * want asserted without a DOM, and the component then only routes events.
 *
 * Detection is the harness's `ui-input-trigger/core/detect.ts`: the scan runs
 * backward from the CARET, stops at whitespace, and only accepts a `/` at a word
 * boundary. Two URL carve-outs keep `/` dead inside links — a `/` right after
 * another `/`, and one right after a `:` that itself follows a non-whitespace
 * character (`https:/…`) — so typing a URL never opens a command menu.
 *
 * The routing rule follows the harness too: a `/word` that IS in the kernel's
 * catalog runs as that command (the kernel answers with its own `command` row);
 * anything else — including `/word` of a command this kernel does not have — is
 * an ordinary prompt, because a surface must not swallow text the registry never
 * claimed.
 */
import type { ClientFrame, CommandSummary } from '../types.js';
import type { ComposerMenuItem } from './ComposerMenu.js';

/** Characters that make up a word: a trigger after one of these is mid-token. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;
/** Whitespace, newlines included: the backward scan stops here. */
const WHITESPACE = /\s/u;

/** The span one `/` token occupies: `[start, end)` in the draft. */
export interface CommandSpan {
  start: number;
  end: number;
  /** The text between the `/` and the caret. */
  query: string;
}

/** One draft read as a command: the registered name and the text after it. */
export interface DraftCommand {
  /** The name as the registry spells it (lowercased, without the slash). */
  name: string;
  /** The argument text, trimmed; '' when nothing was typed after the name. */
  args: string;
}

/**
 * A `/` at `index` opens a token only at the draft's start, after whitespace,
 * or after punctuation — never inside a word or a URL.
 * @param draft - the full draft text.
 * @param index - the `/`'s offset.
 * @returns true when the boundary accepts the trigger.
 */
function boundaryOk(draft: string, index: number): boolean {
  if (index === 0) return true;
  const prev = draft.charAt(index - 1);
  if (WHITESPACE.test(prev)) return true;
  if (WORD_CHAR.test(prev)) return false;
  // `//` is the second slash of a scheme-relative URL.
  if (prev === '/') return false;
  // `C:/path`, `mailto:/…`: a scheme separator, not an ordinary colon.
  if (prev === ':' && index >= 2 && !WHITESPACE.test(draft.charAt(index - 2))) return false;
  return true;
}

/**
 * The `/` token ending at the caret, or null when this is prose.
 *
 * The scan walks left from the caret; whitespace ends it (past the command word
 * the user is writing arguments, and a menu that stayed open would cover the
 * draft it is filtering), and a `/` that fails the boundary rule is treated as
 * an ordinary character so the scan can continue past a URL.
 * @param draft - the full draft text.
 * @param caret - the caret offset into `draft` (defaults to its end).
 * @returns the span, or null when no command token is live.
 */
export function commandSpan(draft: string, caret: number = draft.length): CommandSpan | null {
  const end = Math.max(0, Math.min(caret, draft.length));
  for (let i = end - 1; i >= 0; i -= 1) {
    const ch = draft.charAt(i);
    if (WHITESPACE.test(ch)) return null;
    if (ch !== '/') continue;
    if (!boundaryOk(draft, i)) continue;
    return { start: i, end, query: draft.slice(i + 1, end) };
  }
  return null;
}

/**
 * The command word being typed, or null when this is prose.
 * @param draft - the full draft text.
 * @param caret - the caret offset into `draft` (defaults to its end).
 * @returns the query, or null.
 */
export function slashQuery(draft: string, caret: number = draft.length): string | null {
  return commandSpan(draft, caret)?.query ?? null;
}

/**
 * The rows for one query: name matches first, then description matches.
 * @param commands - the kernel's catalog.
 * @param query - the text after `/`.
 * @returns the rows, name matches first.
 */
export function commandItems(commands: readonly CommandSummary[], query: string): ComposerMenuItem[] {
  const needle = query.trim().toLowerCase();
  const byName: CommandSummary[] = [];
  const byText: CommandSummary[] = [];
  for (const command of commands) {
    const name = command.name.toLowerCase();
    if (needle === '' || name.startsWith(needle)) byName.push(command);
    else if (command.description.toLowerCase().includes(needle)) byText.push(command);
  }
  return [...byName, ...byText].map((command) => ({
    id: command.name,
    // What to type, verbatim: the alias seat the harness uses for the raw
    // command, so a reader copies the token, not a localization of it.
    label: `/${command.name}`,
    description: command.description,
  }));
}

/**
 * What a pick writes into the draft: the live `/` token replaced by the
 * command plus the space its argument goes in, with whatever surrounded the
 * token left alone (a command may be typed mid-draft, and the harness's pick
 * replaces a span rather than the whole surface).
 * @param draft - the full draft text.
 * @param name - the picked command's registered name.
 * @param caret - the caret offset into `draft`.
 * @returns the next draft.
 */
export function commandDraft(draft: string, name: string, caret: number = draft.length): string {
  const span = commandSpan(draft, caret);
  if (span === null) return `/${name} `;
  return `${draft.slice(0, span.start)}/${name} ${draft.slice(span.end)}`;
}

/**
 * The id of the composer's local "add file" row.
 *
 * The `+` menu is not only the kernel's catalog: it is the composer's own action
 * list, and some of those actions are the surface's (the harness registers its
 * File row into the same menu with `ui: { kind: 'action' }`). The `::` prefix
 * keeps it from colliding with a command name, which can never contain `:`.
 */
export const ADD_FILE_ITEM = '::add-file';

/**
 * The local action rows the `+` menu shows above the kernel's commands.
 *
 * Only under the browsing gesture (`pinned`), never for a typed `/query`: a
 * reader filtering commands is asking the registry a question, and answering it
 * with a row the registry does not contain would be a lie about the catalog.
 * @returns the action rows, in display order.
 */
export function actionItems(): ComposerMenuItem[] {
  return [
    {
      id: ADD_FILE_ITEM,
      label: '引用本地文件',
      description: '挑选真实路径写入草稿，不复制文件',
    },
  ];
}

/**
 * Whether Enter/Tab settles the menu rather than acting on the draft.
 *
 * Both trigger sources count, and that is the point: the menu opens for a live
 * `/` token OR a live `@` reference (`InputBar` computes `refSource` from
 * `atQuery`), but this test only ever knew about `/`. So with the FILE menu
 * visibly open on `@src/ma`, Enter failed to settle, fell through to the send
 * path, and submitted the raw mention text as prose — the highlighted file was
 * never taken. The two triggers must answer alike.
 *
 * The `+` control pins the menu open as a *browsing* gesture, so it can be up
 * over ordinary prose. Settling it then would replace what the user typed with a
 * command token — and Enter was meant as "send", so the prompt was lost without
 * ever being sent. An empty draft has nothing to lose: it settles. Prose lets
 * Enter through, and the menu is still pickable by pointer.
 * @param draft - the full draft text.
 * @param caret - the caret offset into `draft`.
 * @param reference - whether an `@` reference token is live at the caret.
 * @returns true when the highlighted row may be settled by Enter.
 */
export function menuSettlesOnEnter(
  draft: string,
  caret: number = draft.length,
  reference = false,
): boolean {
  if (draft.trim() === '') return true;
  return reference || slashQuery(draft, caret) !== null;
}

/** One menu row, as far as key arbitration needs to see it. */
export interface MenuKeyRow {
  /** The row descends into a directory (its chevron is Tab's keyboard twin). */
  drill?: boolean | undefined;
}

/** What a key pressed while the menu is open should do. */
export type MenuKeyDecision =
  /** Move the highlight by this delta. */
  | { kind: 'move'; delta: number }
  /** Take the highlighted row (a drill when `drill`). */
  | { kind: 'pick'; drill: boolean }
  /** The menu is up but this key is not its business: let the composer have it. */
  | { kind: 'pass' };

/**
 * Arbitrate one key against the open menu.
 *
 * This lives here rather than in the component because it is exactly the kind of
 * seam that hides bugs: the caller used to pass the draft WITHOUT the caret to
 * {@link menuSettlesOnEnter} while the menu's open state was derived WITH it, so
 * a live mid-draft token made the two disagree and Enter submitted the prose
 * instead of taking the command. Written over (key, draft, caret, row), every
 * one of those inputs is visible at the call site and assertable without a DOM.
 *
 * Tab DRILLS a directory row rather than settling it — it is the chevron's
 * keyboard twin, and the row prints `Tab` beside that chevron — while a row that
 * cannot drill settles exactly like Enter.
 * @param key - the pressed key name.
 * @param draft - the full draft text.
 * @param caret - the caret offset into `draft`.
 * @param row - the highlighted row, or undefined when the menu has none.
 * @param reference - whether an `@` reference token is live at the caret.
 * @returns what to do with the key.
 */
export function menuKeyDecision(
  key: string,
  draft: string,
  caret: number,
  row: MenuKeyRow | undefined,
  reference = false,
): MenuKeyDecision {
  if (row === undefined) return { kind: 'pass' };
  if (key === 'ArrowDown') return { kind: 'move', delta: 1 };
  if (key === 'ArrowUp') return { kind: 'move', delta: -1 };
  if (key !== 'Enter' && key !== 'Tab') return { kind: 'pass' };
  if (key === 'Tab' && row.drill === true) return { kind: 'pick', drill: true };
  // A pinned menu over prose is browsing, not completion: letting it settle
  // would overwrite the draft and swallow the send.
  if (!menuSettlesOnEnter(draft, caret, reference)) return { kind: 'pass' };
  return { kind: 'pick', drill: false };
}

/**
 * The command a draft is: its leading `/name` token plus the text after it, or
 * null when the draft is not spelled as a command at all (prose, a URL, `/2go`,
 * `/goal?`). One parser, because three readers must agree on what was typed:
 * what Enter sends ({@link draftFrame}), and whether the composer is holding a
 * claim worth hinting (`claim-hint.ts`).
 * @param draft - the full draft text.
 * @returns the token and its trimmed arguments, or null.
 */
export function draftCommand(draft: string): DraftCommand | null {
  const match = /^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i.exec(draft.trim());
  const name = match?.[1]?.toLowerCase();
  if (name === undefined) return null;
  return { name, args: (match?.[2] ?? '').trim() };
}

/**
 * The frame one submitted draft becomes.
 *
 * Only the FIRST token decides: `/compact` with a trailing word still runs the
 * command and hands the rest to it as `args` (that is how a command that takes
 * an argument — `/skill <name>` — is spelled), while a draft that merely
 * mentions a slash mid-sentence stays a prompt.
 * @param draft - the full draft text.
 * @param commands - the kernel's catalog.
 * @returns the frame to send.
 */
export function draftFrame(draft: string, commands: readonly CommandSummary[]): ClientFrame {
  const claim = draftCommand(draft);
  if (claim !== null && commands.some((command) => command.name === claim.name)) {
    return { type: 'command', name: claim.name, args: claim.args };
  }
  return { type: 'prompt', text: draft.trim() };
}
