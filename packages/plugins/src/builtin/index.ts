import { bashPlugin, type BashPluginOptions } from './bash.js';
import { fsReadPlugin, fsWritePlugin } from './fs.js';
import { jobsPlugin } from './jobs.js';
import { ptcPlugin, type PtcPluginOptions } from '../ptc/run-code.js';
import { searchPlugin, type SearchPluginOptions } from './search.js';
import { todoPlugin } from './todo.js';
import type { Plugin } from '../types.js';

export interface BuiltinOptions {
  /** false disables the bash tool plugin; an object customizes it. */
  bash?: boolean | BashPluginOptions;
  /** false disables the background-jobs tools plugin. */
  jobs?: boolean;
  /** false disables the todo tool plugin. */
  todo?: boolean;
  /** Customizes the search tool (worker isolation budget etc.). */
  search?: SearchPluginOptions;
  /**
   * Root directory of the tool-output spill cache (~/.nova/cache/tool-outputs).
   * Paths inside it are classified as auto-allowed 'read' instead of
   * 'read-external', so truncated tool results referenced in the message log
   * can be read back freely without tripping the approval gate every turn.
   */
  spillReadRoot?: string;
  /** PTC mode (Code Mode) configuration; omit or mode "native" disables it. */
  code?: PtcPluginOptions;
}

/** First-party tool plugins; loaded through the same API as third-party ones. */
export function builtinPlugins(options?: BuiltinOptions): Plugin[] {
  const trustedReadRoots = options?.spillReadRoot !== undefined ? [options.spillReadRoot] : [];
  const plugins: Plugin[] = [
    fsReadPlugin({ trustedReadRoots }),
    fsWritePlugin(),
    searchPlugin({ ...options?.search, trustedReadRoots }),
  ];
  const bash = options?.bash;
  if (bash !== false) {
    plugins.push(bashPlugin(bash === true || bash === undefined ? undefined : bash));
  }
  if (options?.jobs !== false) plugins.push(jobsPlugin());
  if (options?.todo !== false) plugins.push(todoPlugin());
  const code = options?.code;
  if (code !== undefined && (code.mode ?? 'both') !== 'native') {
    // Last: its beforeLLMCall projection must run after any earlier
    // tool-affecting hooks, and its activation sees the full tool set.
    plugins.push(ptcPlugin(code));
  }
  return plugins;
}
