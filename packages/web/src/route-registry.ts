/**
 * The concrete HTTP route registry the WebUI host publishes for plugins.
 *
 * Lives in `web` (not `plugins`) because the registry is meaningful only when
 * paired with the HTTP server that owns the request loop — a headless surface
 * has no request loop and therefore publishes nothing. Plugins register through
 * the kernel container (`ctx.must(routes)` returns this same instance via the
 * `routeRegistryProvider` plugin); the WebUI request handler reads `dispatch`
 * before its own fallbacks.
 *
 * The registry is **append-only and last-wins**: a plugin that loads later in
 * the roster overrides an earlier plugin's same prefix. The dispatch order on
 * each request is reverse-registration (latest plugin wins), which mirrors the
 * container's own replace-by-key semantics for service providers.
 */
import type { PluginRoute, PluginRouteHandler, RouteRegistry } from '@nova-agent/core';

export class WebRouteRegistry implements RouteRegistry {
  private readonly entries: PluginRoute[] = [];

  register(route: PluginRoute): void {
    if (route.prefix.length === 0 || route.prefix[0] !== '/') return;
    this.entries.push(route);
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
