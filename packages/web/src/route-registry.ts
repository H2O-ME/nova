/**
 * The plugin asset route registry the desktop host publishes for plugins.
 *
 * Lives in `web` (not `plugins`) because the registry is meaningful only when
 * paired with the host that serves plugin client bundles — a surface with no
 * plugin loader publishes nothing. Plugins register through the kernel
 * container (`ctx.must(routes)` returns this same instance via the
 * `routeRegistryProvider` plugin); the `plugin_asset` frame handler reads
 * `dispatch` to answer a bundle request.
 *
 * The registry is **append-only, identity-removable and last-wins**: a plugin
 * that loads later in the roster overrides an earlier plugin's same prefix,
 * and `register` hands back the disposer that retires exactly that one
 * registration. The dispatch order on each request is reverse-registration
 * (latest plugin wins), which mirrors the container's own replace-by-key
 * semantics for service providers — and the disposer is what makes an
 * UNLOAD mirror it too: a plugin routes nowhere once its fiber is gone,
 * instead of answering requests through a handler closure nobody owns.
 */
import type { PluginRoute, PluginRouteHandler, RouteRegistry } from '@nova-agent/core';

export class WebRouteRegistry implements RouteRegistry {
  private readonly entries: PluginRoute[] = [];

  register(route: PluginRoute): () => void {
    if (route.prefix.length === 0 || route.prefix[0] !== '/') return () => undefined;
    this.entries.push(route);
    return () => {
      const index = this.entries.indexOf(route);
      if (index >= 0) this.entries.splice(index, 1);
    };
  }

  routes(): readonly PluginRoute[] {
    return [...this.entries];
  }

  /**
   * Resolve a handler for one request path. Returns the FIRST matching route
   * searching REVERSE registration order, so a plugin loaded later overrides
   * an earlier plugin's prefix. `undefined` means "no plugin answered" — the
   * caller falls through to its own handlers.
   */
  handlerFor(pathname: string): PluginRouteHandler | undefined {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const route = this.entries[i]!;
      if (pathname === route.prefix || pathname.startsWith(`${route.prefix}/`)) {
        return route.handler;
      }
    }
    return undefined;
  }
}
