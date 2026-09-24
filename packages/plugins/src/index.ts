/**
 * The plugin world: the container-backed tool host, the built-in plugins, the
 * kernel assembly, and the capability providers that fill the seams.
 *
 * Two plugin shapes meet here, deliberately:
 *  - the **public** one (`{ name, activate(ctx) }` over `PluginContext`) that
 *    built-ins and third parties write against, and
 *  - the **container** one (core's `Context.plugin`, with `inject`, effects and
 *    the capability keys) that the kernel's own seams use.
 *
 * `PluginHost` adapts the first onto the second, which is why a registered tool
 * is undone automatically when its plugin unloads.
 */
export * from './types.js';
export * from './permission.js';
export * from './host.js';
export * from './toolbox.js';
export * from './hooks.js';
export * from './services.js';
export * from './roster.js';
export * from './headless-compact.js';
export * from './builtin/index.js';
export * from './runtime.js';
export * from './runtime-env.js';
export * from './runtime-facade.js';
export * from './kernel-commands.js';
export * from './runtime-models.js';
export * from './runtime-roster.js';
export * from './runtime-session.js';
export * from './agents-md.js';
export * from './system-prompt.js';
export { resolveInRoot, READ_MAX_BYTES } from './builtin/fs.js';
export { POWERSHELL_UTF8_PREFIX, powershellInvocation, bashOnPath, resolveShellName } from './builtin/bash.js';
export * from './skills.js';
export * from './ptc/json.js';
export * from './ptc/sdk.js';
export * from './ptc/code-runtime.js';
export * from './ptc/run-code.js';