/**
 * The surface registry: the live home of `AgentSurface` plugins. The cli reads
 * `~/.nova/config.json` `surfaces` (module specs), `loadSurfacePlugins`
 * dynamically imports each, and a registry built with `createSurfaceRegistry`
 * resolves which one claims an invocation — so a surface is a config row, not a
 * hardcoded entry.
 *
 * Mirrors `roster.ts`'s `loadExtraPlugins` discipline (one spec-resolution
 * rule, loud failure on a missing export) so surface and kernel-plugin
 * loading agree on what a config string means.
 *
 * The `surfaces` capability ServiceKey in `core/plugin/capabilities.ts` stays
 * declared but intentionally has no in-container provider here: the registry
 * must exist before the kernel does (the kernel is assembled AFTER surfaces
 * are loaded, so it can be handed the chosen surface), so no consumer can
 * read it through `ctx.get(surfaces)`. Providing without an in-container
 * consumer would be a worse state than the honestly-dead seam; the public API
 * the surface model needs is `AgentSurface` + `loadSurfacePlugins`, not the
 * container key.
 */
import {
  surfaces as surfacesKey,
  type AgentSurface,
  type AgentSurfaceRequest,
  type Context,
  type Plugin as CorePlugin,
  type SurfaceRegistry,
} from '@nova-agent/core';
import { resolveModuleSpec } from './roster.js';

/** An empty registry a caller populates via `register()` (or `loadSurfacePlugins`). */
export function createSurfaceRegistry(): SurfaceRegistry {
  const list: AgentSurface[] = [];
  let claimed: AgentSurface | undefined;
  return {
    all: () => [...list],
    resolve: (request: AgentSurfaceRequest) => {
      // Record the winner as a side effect of resolving: the `userQuestions`
      // service only has the registry, so this is how "the surface in force"
      // reaches it without the resolution result being threaded through the
      // kernel assembly by hand.
      claimed = list.find((surface) => surface.claim(request));
      return claimed;
    },
    register: (surface) => {
      list.push(surface);
      return () => {
        const index = list.indexOf(surface);
        if (index >= 0) list.splice(index, 1);
      };
    },
    current: () => claimed,
  };
}

/**
 * Load `surfaces`: module specifiers (absolute, relative to cwd, or bare
 * package names) whose `default` (or `surface`) export is an `AgentSurface`.
 * A module that does not export one fails loudly with its specifier, mirroring
 * `plugins.extra` — a silently ignored surface is worse than a broken boot.
 */
export async function loadSurfacePlugins(specs: readonly string[], cwd: string): Promise<AgentSurface[]> {
  const out: AgentSurface[] = [];
  for (const spec of specs) {
    const target = resolveModuleSpec(spec, cwd);
    let module: Record<string, unknown>;
    try {
      module = (await import(target)) as Record<string, unknown>;
    } catch (err) {
      throw new Error(`surfaces: cannot load "${spec}": ${message(err)}`);
    }
    const candidate = module['default'] ?? module['surface'];
    if (!isAgentSurface(candidate)) {
      throw new Error(`surfaces: "${spec}" does not export a surface (default or "surface")`);
    }
    out.push(candidate);
  }
  return out;
}

function isAgentSurface(value: unknown): value is AgentSurface {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { name?: unknown }).name === 'string' &&
    typeof (value as { claim?: unknown }).claim === 'function' &&
    typeof (value as { start?: unknown }).start === 'function'
  );
}

/**
 * Adapt one surface module to the container-native plugin protocol.
 *
 * The row registers the surface through the injected `surfaces` service. It does
 * not use the legacy `{ name, activate }` facade: that facade is only the
 * compatibility path for existing tool/command plugins. Keeping this adapter
 * native gives a surface the same `inject`/`apply` lifecycle as dsh-TUI and makes
 * disposal part of the owning fiber.
 *
 * @param surface - loaded surface implementation.
 * @param registry - registry instance provided by the assembly.
 * @returns a container plugin row.
 */
export function surfacePlugin(surface: AgentSurface, registry: SurfaceRegistry): CorePlugin {
  return {
    name: surface.name,
    inject: [surfacesKey],
    apply: (ctx: Context): void => {
      const service = ctx.must(surfacesKey);
      ctx.effect(() => service.register(surface), `surface(${surface.name})`);
      if (service !== registry) {
        throw new Error(`surface ${surface.name} received a different registry instance`);
      }
    },
  };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
