/**
 * Surface resolution: the ONE registry, built in precedence order.
 *
 * 内置四家（qqbot / exec / web / repl）与配置加载的动态 surface 是同一份
 * `AgentSurface` 契约、同一个注册表、同一段装配（`surface-host.ts`）。注册顺序
 * 即优先级——子命令 → 配置的 surface → 默认（web / repl）——壳只问一次
 * `registry.resolve`，「谁服务这次调用」全仓一个答案；`registry.current()` 从此
 * 对每一类 surface 都有值（`userQuestions` 的单一来源，见 `runtime-env.ts`）。
 *
 * argv → options 在 `cli-args.ts`；装配在 `surface-host.ts`；四个内置各自的
 * claim 判据与启动前置在各自的 surface 文件里——qqbot 的产品形态在它自己的包
 * （`qqbot-surface.ts` 只留认领与凭据端口的适配）。
 */
import process from 'node:process';
import { errMessage, type SurfaceRegistry, type SurfaceRows } from '@nova-agent/core';
import { loadSurfacePlugins } from '@nova-agent/plugins';
import type { Config, ConfigDiagnostic } from './config.js';
import { execSurface } from './exec.js';
import { replSurface } from './repl.js';
import { qqbotBuiltinSurface } from './qqbot-surface.js';
import type { BuiltinSurface } from './surface-host.js';
import { webSurface } from './web-mode.js';

export type { BuiltinSurface, SurfaceBoot, SurfaceRequest } from './surface-host.js';
// argv → options 的公开面留在 `cli-args.ts`，这里原样转出去（历史导入点）。
export { parseArgs, resumeAndApproval, type ParsedArgs } from './cli-args.js';

/**
 * The four built-ins in two groups: `head` claims before configured surfaces
 * (the subcommands), `tail` after them (the defaults). The shell registers
 * `head`, then the configured surfaces, then `tail`; registration order IS the
 * precedence contract.
 */
export interface Builtins {
  readonly head: readonly BuiltinSurface[];
  readonly tail: readonly BuiltinSurface[];
}

export function builtinSurfaces(m: { config: Config; diagnostics: readonly ConfigDiagnostic[] }): Builtins {
  return {
    head: [qqbotBuiltinSurface(m.config), execSurface(m.config)],
    tail: [webSurface(m), replSurface(m.config)],
  };
}

/** Load and register the configured surfaces into the SAME registry the resolver reads. */
export async function loadDynamicSurfaces(
  config: Config,
  cwd: string,
  registry: SurfaceRegistry,
): Promise<SurfaceRows> {
  const specs = config.surfaces;
  // An absent or empty `surfaces` key yields nothing — the cli never names a
  // surface package in source, so what loads is exactly what the operator
  // declared in `~/.nova/config.json`.
  if (specs === undefined || specs.length === 0) return { registry, loaded: [] };
  const surfaces = await loadSurfacePlugins(specs, cwd);
  for (const surface of surfaces) registry.register(surface);
  return { registry, loaded: surfaces };
}

/** Errors reach the terminal as one line, never as a stack (user-facing CLI). */
export function reportError(err: unknown): void {
  console.error(errMessage(err));
  process.exitCode = 1;
}
