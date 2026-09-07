import { bashPlugin, type BashPluginOptions } from './bash.js';
import { fsReadPlugin, fsWritePlugin } from './fs.js';
import { jobsPlugin } from './jobs.js';
import { ptcPlugin, type PtcPluginOptions } from '../ptc/run-code.js';
import { searchPlugin } from './search.js';
import { todoPlugin } from './todo.js';
import type { Plugin } from '../types.js';

export interface BuiltinOptions {
  /** false disables the bash tool plugin; an object customizes it. */
  bash?: boolean | BashPluginOptions;
  /** false disables the background-jobs tools plugin. */
  jobs?: boolean;
  /** false disables the todo tool plugin. */
  todo?: boolean;
  /** PTC mode (Code Mode) configuration; omit or mode "native" disables it. */
  code?: PtcPluginOptions;
}

/** First-party tool plugins; loaded through the same API as third-party ones. */
export function builtinPlugins(options?: BuiltinOptions): Plugin[] {
  const plugins: Plugin[] = [fsReadPlugin(), fsWritePlugin(), searchPlugin()];
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
