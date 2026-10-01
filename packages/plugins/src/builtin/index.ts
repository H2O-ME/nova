import { type Plugin } from '@nova-agent/core';
import { askUserPlugin, type AskUserPluginOptions } from './ask-user.js';
import { bashPlugin, type BashPluginOptions } from './bash.js';
import { fsReadPlugin, fsWritePlugin } from './fs.js';
import { goalPlugin, type GoalPluginOptions } from './goal.js';
import { jobsPlugin } from './jobs.js';
import { searchPlugin, type SearchPluginOptions } from './search.js';
import { todoPlugin } from './todo.js';
import { workspacePlugin, type WorkspacePluginOptions } from './workspace.js';

export { askUserPlugin, parseQuestions, type AskUserPluginOptions } from './ask-user.js';

export interface BuiltinOptions {
  /**
   * The LIVE workspace root every workspace-bound tool grades against. A thunk
   * for the same reason `workspace.onChange` is a callback: `switch_workspace`
   * re-points the root mid-session, and a tool holding the boot value would keep
   * reading and writing the directory the session has already left.
   */
  rootDir: () => string;
  /** false disables the bash tool plugin; an object customizes it. */
  bash?: boolean | BashPluginOptions;
  /** false disables the background-jobs tools plugin. */
  jobs?: boolean;
  /** false disables the todo tool plugin. */
  todo?: boolean;
  /** false disables the switch_workspace tool; an object wires the runner callback (tool registered only when provided). */
  workspace?: false | WorkspacePluginOptions;
  /** Customizes the search tool (worker isolation budget etc.). */
  search?: Omit<SearchPluginOptions, 'rootDir' | 'trustedReadRoots'>;
  /**
   * Root directory of the tool-output spill cache (~/.nova/cache/tool-outputs).
   * Paths inside it are classified as auto-allowed 'read' instead of
   * 'read-external', so truncated tool results referenced in the message log
   * can be read back freely without tripping the approval gate every turn.
   */
  spillReadRoot?: string;
  /**
   * Extra auto-readable roots outside the workspace. Listed separately from
   * `spillReadRoot` because the two roots are owned by different subsystems and
   * either can be absent.
   *
   * NOTE: no caller passes this today — the spill root is the only trusted read
   * root in force. There is deliberately no uploads tree to name here: pasted
   * images live under the content-addressed `images/` store (request-side bytes,
   * never opened by a tool), and a file that has a path crosses as `@path` text
   * instead of being copied. Kept as the seam for a future surface that stages
   * its own bytes.
   */
  trustedReadRoots?: readonly string[];
  /**
   * The model's question tool. Always registered — a surface with no human to ask
   * gets the typed `NO_PROVIDER` refusal rather than a silently missing tool, so
   * the model learns the difference instead of guessing — but the answerer itself
   * comes from the `userQuestions` container service, which the surface in force
   * decides.
   */
  askUser?: AskUserPluginOptions;
  /**
   * The durable goal: its live reader and its log writer.
   *
   * Required for the goal tools to exist, and wired at the ASSEMBLY point because
   * the goal lives in the session log, which is a kernel fact rather than a tool
   * option. Omitted ⇒ no goal plugin, which is honest — a surface with no session
   * cannot persist one.
   */
  goal?: GoalPluginOptions;
}

/**
 * The auto-readable roots, as one list. The spill root is one of them, not a
 * special case of it: this concatenates the two sources so the fs and search
 * plugins receive the single array they already understand, with empties dropped
 * (an empty root would match every path).
 * @param options - the build's options.
 * @returns the roots, in the order they should be consulted.
 */
function trustedRoots(options: BuiltinOptions): string[] {
  return [
    ...(options.spillReadRoot !== undefined ? [options.spillReadRoot] : []),
    ...(options.trustedReadRoots ?? []),
  ].filter((root) => root.length > 0);
}

/** First-party tool plugins; loaded through the same API as third-party ones. */
export function builtinPlugins(options: BuiltinOptions): Plugin[] {
  const rootDir = options.rootDir;
  const trustedReadRoots = trustedRoots(options);
  const plugins: Plugin[] = [
    fsReadPlugin({ trustedReadRoots, rootDir }),
    fsWritePlugin({ rootDir }),
    searchPlugin({ ...options.search, trustedReadRoots, rootDir }),
  ];
  const bash = options.bash;
  if (bash !== false) {
    plugins.push(bashPlugin(bash === true || bash === undefined ? undefined : bash));
  }
  if (options.jobs !== false) plugins.push(jobsPlugin());
  if (options.todo !== false) plugins.push(todoPlugin());
  // Present only when the assembly supplied a live-goal reader and a log writer
  // (see `BuiltinOptions.goal`): without them the tools could report a goal no
  // resume would ever recover.
  if (options.goal !== undefined) plugins.push(goalPlugin(options.goal));
  // Unconditional (see `BuiltinOptions.askUser`): the tool is the model's only
  // way to learn that this surface has no answerer.
  plugins.push(askUserPlugin(options.askUser ?? {}));
  const workspace = options.workspace;
  // Opt-in only: without a runner-side onChange callback the tool would
  // validate a switch and then silently do nothing — worse than absent.
  if (workspace !== undefined && workspace !== false) {
    plugins.push(workspacePlugin(workspace));
  }
  // The three `advanced` EXTENSION plugins (subagent / context / ptc) are NOT
  // here: they load from their own packages by specifier (see `extensions.ts`),
  // because they must be absentable — this file is the base roster.
  return plugins;
}
