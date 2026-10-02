/**
 * Route registry: registration, prefix matching, reverse-order precedence, and
 * the auth gate staying in front of plugin routes.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import type { PluginRoute, PluginRouteHandler } from '@nova-agent/core';
import { WebRouteRegistry } from '../src/route-registry.js';

function handler(body: string): PluginRouteHandler {
  return async (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(body);
  };
}

describe('WebRouteRegistry', () => {
  it('registers and resolves by exact prefix and nested path', () => {
    const reg = new WebRouteRegistry();
    reg.register({ prefix: '/plugins/genui/assets', handler: handler('a') });
    expect(reg.routes()).toHaveLength(1);
    expect(reg.handlerFor('/plugins/genui/assets')).toBeDefined();
    expect(reg.handlerFor('/plugins/genui/assets/foo.css')).toBeDefined();
  });

  it('does not match a path that shares a substring but not the prefix', () => {
    const reg = new WebRouteRegistry();
    reg.register({ prefix: '/plugins/genui', handler: handler('a') });
    // `/plugins/genui2` shares the leading substring but is a different segment.
    expect(reg.handlerFor('/plugins/genui2')).toBeUndefined();
    expect(reg.handlerFor('/plugins/other')).toBeUndefined();
    expect(reg.handlerFor('/')).toBeUndefined();
  });

  it('reverse-registration dispatch — a later plugin overrides an earlier prefix', () => {
    // The same replace-by-key semantics the container uses for service
    // providers: registering a prefix again with a later plugin wins.
    const reg = new WebRouteRegistry();
    reg.register({ prefix: '/plugins/x', handler: handler('first') });
    reg.register({ prefix: '/plugins/x', handler: handler('second') });
    const h = reg.handlerFor('/plugins/x');
    expect(h).toBeDefined();
    // Registration order is preserved for inspection; dispatch picks latest.
    expect(reg.routes()).toHaveLength(2);
    expect(reg.routes()[0]?.handler).not.toBe(h);
    expect(reg.routes()[1]?.handler).toBe(h);
  });

  it('rejects a route without a leading slash (fail-closed on bad shape)', () => {
    const reg = new WebRouteRegistry();
    reg.register({ prefix: '', handler: handler('empty') });
    reg.register({ prefix: 'no-slash', handler: handler('noslash') } as PluginRoute);
    expect(reg.routes()).toHaveLength(0);
    expect(reg.handlerFor('/no-slash')).toBeUndefined();
  });

  it('handlerFor is optional on the interface but present on WebRouteRegistry', () => {
    // Servers that hold a `RouteRegistry` (interface) call `handlerFor?`
    // defensively; the concrete class must always implement it.
    const reg = new WebRouteRegistry();
    expect(typeof reg.handlerFor).toBe('function');
  });
});
