/**
 * Provider-neutral **presentation vocabulary**: the shape of what a tool call
 * means, so every surface (TUI, web, headless JSON, QQ) renders the same call
 * from the same structured intent instead of special-casing tool names.
 *
 * This file owns *shape and semantics* only — no copy (no Chinese labels, no
 * humanized byte counts), no colors, no column widths. Those belong to the
 * surface: a terminal has an ANSI palette and a column budget, a browser has
 * CSS, a bot channel has neither — none of them may leak in here.
 *
 * Tools opt in with `ToolDefinition.presentCall` / `.presentResult` (see
 * types.ts). A tool that declares nothing renders from the generic card — so a
 * new or third-party tool is never *un*renderable, only less specific.
 *
 * Every view is a `card`-tagged discriminated union: a surface switches on
 * `view.card`, and a surface that understands only `generic` can still render
 * any view by falling back to its `title`/`text`.
 */

/** Semantic class of one tool call — what it *does*, independent of any UI. */
export type ToolCallKind =
  | 'read'
  | 'edit'
  | 'write'
  | 'search'
  | 'execute'
  | 'job'
  | 'plan'
  | 'other';

/** A spot in a file the user can jump to (`line` 1-based, absent = whole file). */
export interface FileLocation {
  path: string;
  line?: number;
}

/**
 * One intended file mutation. `oldText: null` means "no prior content to
 * match" — creating a file, not editing one.
 */
export interface FileDiff {
  path: string;
  oldText: string | null;
  newText: string;
}

/** Fallback call card: enough to render a line for any tool, ever. */
export interface GenericCallView {
  card: 'generic';
  kind: ToolCallKind;
  /** Primary operand as *data* (path, id, prompt) — never a translated label. */
  title: string;
  /** Secondary operand, e.g. a pattern alongside a starting directory. */
  subtitle?: string;
}
export interface TerminalCallView {
  card: 'terminal';
  command: string;
}
export interface DiffCallView {
  card: 'diff';
  diffs: FileDiff[];
}
export interface SearchCallView {
  card: 'search';
  query: string;
  mode: 'content' | 'name';
}

/** What one tool call *is*, before it runs (approval prompts, live tool lines). */
export type ToolCallView = GenericCallView | TerminalCallView | DiffCallView | SearchCallView;

export interface GenericResultView {
  card: 'generic';
  ok: boolean;
  text: string;
}
export interface TerminalResultView {
  card: 'terminal';
  /** Captured output as displayed (stdout, plus stderr when the tool merged it). */
  output: string;
  /** Process exit code; `null` = the process never exited (killed/aborted). */
  exitCode: number | null;
  /** Bytes the tool dropped from the middle of the output, when it truncated. */
  droppedBytes?: number;
}
export interface DiffResultView {
  card: 'diff';
  ok: boolean;
  diffs: FileDiff[];
}
export interface SearchResultView {
  card: 'search';
  matches: FileLocation[];
  /** Result cap or abort cut the list short — the surface says "more exist". */
  truncated: boolean;
}
export interface ReadResultView {
  card: 'read';
  path: string;
  lineCount: number;
  /** The window returned a slice, not the whole file. */
  truncated: boolean;
}
export interface PlanResultView {
  card: 'plan';
  items: readonly { text: string; status: string }[];
}

/** What one tool call *produced* (collapsed tool rows, replay, transcripts). */
export type ToolResultView =
  | GenericResultView
  | TerminalResultView
  | DiffResultView
  | SearchResultView
  | ReadResultView
  | PlanResultView;

/** Kinds whose payload is a filesystem location — the tail of a path is the story. */
export const PATH_ARG_KINDS: readonly ToolCallKind[] = ['read', 'edit', 'write'];
/** Kinds that mutate nothing, so a surface may group them into one live row. */
export const READ_ONLY_KINDS: readonly ToolCallKind[] = ['read', 'search'];

export function isPathArgKind(kind: ToolCallKind): boolean {
  return PATH_ARG_KINDS.includes(kind);
}

export function isReadOnlyKind(kind: ToolCallKind): boolean {
  return READ_ONLY_KINDS.includes(kind);
}

/**
 * Semantic class of the tools this framework ships, keyed by tool name. Purely
 * a **fallback** for surfaces that render a call before (or without) a
 * `presentCall` result; third-party tools get `'other'` and should declare
 * their own view. Kept here, not in a rendering package, because *which
 * category a built-in tool belongs to* is domain knowledge every surface needs
 * and none of them should re-derive by name.
 */
export const BUILTIN_TOOL_KINDS: Record<string, ToolCallKind> = {
  bash: 'execute',
  run_code: 'execute',
  read_file: 'read',
  list_dir: 'read',
  search_files: 'search',
  write_file: 'write',
  edit_file: 'edit',
  jobs: 'job',
  todo_write: 'plan',
  subagent: 'other',
  get_time: 'other',
};

export function toolCallKind(name: string): ToolCallKind {
  return BUILTIN_TOOL_KINDS[name] ?? 'other';
}

/**
 * Just enough of a registry entry to resolve a call's render intent. The
 * plugin host's `ToolDefinition` satisfies it structurally, so a surface can
 * hand in `host.tools` without core knowing what a plugin is.
 */
export interface ToolViewSource {
  name: string;
  presentCall?(args: Record<string, unknown>): ToolCallView | undefined;
  presentResult?(args: Record<string, unknown>, content: string): ToolResultView | undefined;
}

/** Keys whose value reads as *the thing this call is about*, best first. */
const OPERAND_KEYS = ['path', 'file', 'file_path', 'dir', 'directory', 'command', 'pattern', 'query', 'name', 'glob', 'id'];

/**
 * The fallback card for a call no tool declared a view for. The title is the
 * call's primary operand as **data**, picked by argument *shape* — never by
 * tool name (that name-keyed guessing is what this vocabulary replaced); with
 * no string operand at all it degrades to the raw args, so a third-party tool
 * is still renderable, only less specific.
 */
export function genericCallView(call: { name: string; args: Record<string, unknown> }): GenericCallView {
  const strings = Object.entries(call.args).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0,
  );
  const chosen = OPERAND_KEYS.map((key) => strings.find(([k]) => k === key)).find((entry) => entry !== undefined) ?? strings[0];
  const title = chosen?.[1] ?? truncateJson(call.args);
  const subtitle = chosen === undefined ? undefined : strings.find(([, value]) => value !== chosen[1])?.[1];
  return { card: 'generic', kind: toolCallKind(call.name), title, ...(subtitle !== undefined ? { subtitle } : {}) };
}

function truncateJson(args: Record<string, unknown>): string {
  const text = JSON.stringify(args) ?? '{}';
  return text.length > 200 ? `${text.slice(0, 197)}…` : text;
}

/** Render intent for a call: the tool's own declaration, else the generic card. */
export function callViewOf(
  tools: readonly ToolViewSource[],
  call: { name: string; args: Record<string, unknown> },
): ToolCallView {
  return tools.find((tool) => tool.name === call.name)?.presentCall?.(call.args) ?? genericCallView(call);
}

/**
 * Render intent for a result: the tool's own declaration, else the generic
 * card over the raw text — with `ok` from the shared failure semantics below,
 * so a surface no longer copies that heuristic to decide how to color a row.
 */
export function resultViewOf(
  tools: readonly ToolViewSource[],
  call: { name: string; args: Record<string, unknown> },
  content: string,
): ToolResultView {
  return (
    tools.find((tool) => tool.name === call.name)?.presentResult?.(call.args, content) ?? {
      card: 'generic',
      ok: !isFailureContent(content),
      text: content,
    }
  );
}

/**
 * Does this tool-result string represent a failure? A tool's return value is
 * its only report channel, so this string semantics is a *core* fact, not a
 * rendering choice (previously it lived in the terminal view layer, where
 * headless consumers had to copy it).
 */
export function isFailureContent(content: string): boolean {
  return (
    content.startsWith('Error') ||
    content.startsWith('Permission denied') ||
    /(^|\n)exit: [1-9]/.test(content) ||
    content.includes('did not exit')
  );
}
