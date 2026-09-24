/**
 * The `/` menu's decisions, as pure functions: when it opens, what it lists for
 * the text typed so far, what a pick writes into the draft, and — the one that
 * matters — what a submitted draft MEANS (a command frame or a prompt).
 *
 * Split from `InputBar` for the usual reason: these are the rules a reader would
 * want asserted without a DOM, and the component then only routes events.
 *
 * The routing rule follows the harness: a leading `/word` that IS in the
 * kernel's catalog runs as that command (the kernel answers with its own
 * `command` row); anything else — including `/word` of a command this kernel
 * does not have — is an ordinary prompt, because a surface must not swallow
 * text the registry never claimed.
 */
import type { ClientFrame, CommandSummary } from '../types.js';
import type { ComposerMenuItem } from './ComposerMenu.js';

/** The command being typed: the leading `/` run, or null when this is prose. */
export function slashQuery(draft: string): string | null {
  const trimmed = draft.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const token = trimmed.slice(1);
  // A space ends the command word: past it the user is writing arguments, and a
  // menu that stayed open would cover the draft it is filtering.
  return /\s/.test(token) ? null : token;
}

/** The rows for one query: name matches first, then description matches. */
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

/** What a pick writes into the draft: the token plus the space for its argument. */
export function commandDraft(name: string): string {
  return `/${name} `;
}

/**
 * Whether Enter/Tab settles the menu rather than acting on the draft.
 *
 * The `+` control pins the menu open as a *browsing* gesture, so it can be up
 * over ordinary prose. Settling it then would replace what the user typed with a
 * command token — and Enter was meant as "send", so the prompt was lost without
 * ever being sent. An empty draft has nothing to lose, and a slash query is the
 * menu's own trigger: both settle. Prose lets Enter through, and the menu is
 * still pickable by pointer.
 */
export function menuSettlesOnEnter(draft: string): boolean {
  return draft.trim() === '' || slashQuery(draft) !== null;
}

/**
 * The frame one submitted draft becomes.
 *
 * Only the FIRST token decides: `/compact` with a trailing word still runs the
 * command and hands the rest to it as `args` (that is how a command that takes
 * an argument — `/skill <name>` — is spelled), while a draft that merely
 * mentions a slash mid-sentence stays a prompt.
 */
export function draftFrame(draft: string, commands: readonly CommandSummary[]): ClientFrame {
  const text = draft.trim();
  const match = /^\/([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i.exec(text);
  const name = match?.[1]?.toLowerCase();
  if (name !== undefined && commands.some((command) => command.name === name)) {
    return { type: 'command', name, args: (match?.[2] ?? '').trim() };
  }
  return { type: 'prompt', text };
}