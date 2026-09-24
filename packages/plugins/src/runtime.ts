/**
 * `createAgentKernel` — the one assembly point between the kernel and the
 * plugin world.
 *
 * The browser UI, the readline REPL, the bot channel and the headless runners
 * all drive THIS, so no surface can drift from the others. Four steps:
 *
 *  1. open a container root — the whole app's plugin world (`runtime-env`);
 *  2. publish the capability services (approval, llm, jobs, sessions, spill,
 *     compaction, skills) as provider plugins, each replaceable by key;
 *  3. build the tool host on that same root and load the roster — built-ins,
 *     the surface's plugins and `plugins.extra` from config, minus
 *     `plugins.disable` — then the approval gate, which reads the live registry
 *     and gate (`runtime-roster`);
 *  4. open the first session handle through the `sessions` service.
 *
 * The provider is injected (core defines `ChatProvider`; only the shells build
 * one from config): the same seam that keeps the loop provider-agnostic keeps
 * the assembly surface-agnostic.
 *
 * The surrounding files exist so each step reads alone: `runtime-types`
 * (contracts) — `runtime-env` (container + closures) — `runtime-roster` (what
 * loads) — `runtime-facade` (the object surfaces hold).
 */
import { skills as skillsKey } from '@nova-agent/core';
import { permissionGatePlugin } from './hooks.js';
import { createEnvironment } from './runtime-env.js';
import { facade } from './runtime-facade.js';
import type { CreateKernelOptions, Kernel } from './runtime-types.js';
export type { CreateKernelOptions, Kernel, KernelConfig, PluginRosterEntry } from './runtime-types.js';

export async function createAgentKernel(opts: CreateKernelOptions): Promise<Kernel> {
  const env = createEnvironment(opts);
  await env.reroster();
  env.root.plugin(permissionGatePlugin, {}, 'approval-gate');
  await env.root.must(skillsKey).reload();
  await env.openCurrent(
    opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : { sessionDir: opts.sessionDir },
  );
  return facade(env, opts.modelCatalog);
}
