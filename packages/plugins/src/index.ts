/**
 * The plugin world: the container-backed tool host, the built-in plugins, the
 * kernel assembly, and the capability providers that fill the seams.
 *
 * ONE plugin shape is public here: core's `Plugin` (`{ name, inject?, apply }`),
 * loaded onto a `Context`. Built-ins and third parties write against exactly the
 * same contract; capability services are declared in `inject` and read with
 * `ctx.must(key)`, so replacing a provider reloads its consumers instead of
 * stranding them on a captured handle.
 */
export * from './permission.js';
export * from './host.js';
export * from './toolbox.js';
export * from './hooks.js';
export * from './services.js';
export * from './roster.js';
export * from './roster-filter.js';
export * from './surface-registry.js';
export * from './plugin-tier.js';
export * from './headless-compact.js';
export * from './builtin/index.js';
export * from './runtime.js';
export * from './runtime-env.js';
export * from './runtime-facade.js';
export * from './kernel-commands.js';
export * from './runtime-models.js';
export * from './runtime-roster.js';
export * from './runtime-switch.js';
export * from './runtime-session.js';
export * from './agents-md.js';
export * from './agents-md-init.js';
export * from './system-prompt.js';
export { resolveInRoot, READ_MAX_BYTES } from './builtin/fs.js';
export { POWERSHELL_UTF8_PREFIX, powershellInvocation, bashOnPath, resolveShellName, startBashJob } from './builtin/bash.js';
export type { BashJobRequest } from './builtin/bash.js';
export * from './skills.js';
export * from './ptc/json.js';
export * from './ptc/sdk.js';
export * from './ptc/code-runtime.js';
export * from './ptc/run-code.js';
