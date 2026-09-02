import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { McpClient } from '../src/client.js';
import { HttpMcpTransport } from '../src/http.js';
import { StdioMcpTransport } from '../src/stdio.js';
import { mcpPlugin } from '../src/plugin.js';
import { PluginHost } from '@nova-agent/plugins';

const FIXTURE = fileURLToPath(new URL('./fixtures/echo-server.mjs', import.meta.url));

describe('stdio transport + McpClient', () => {
  it('initializes, lists tools and calls them through the fixture server', { timeout: 20_000 }, async () => {
    const transport = new StdioMcpTransport(process.execPath, { args: [FIXTURE] });
    const client = new McpClient('echo', transport, { requestTimeoutMs: 10_000 });
    try {
      await client.connect();
      const tools = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]).toMatchObject({ name: 'echo', description: 'Echoes the given text' });

      const result = await client.callTool('echo', { text: '你好 nova' });
      expect(result).toEqual({ text: 'echo:你好 nova', isError: false });
    } finally {
      await client.close();
    }
  });

  it('rejects calls with a readable error when the server dies', { timeout: 20_000 }, async () => {
    const transport = new StdioMcpTransport(process.execPath, {
      args: ['-e', 'process.exit(1)'],
    });
    const client = new McpClient('dead', transport);
    await expect(client.connect()).rejects.toThrow(/exited|spawn/);
    await client.close();
  });
});

function jsonRpcResponse(id: number, result: unknown, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    status: 200,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

/** Fake Streamable-HTTP endpoint handling the standard handshake methods. */
function makeHandler(
  handlers: Record<string, (id: number) => Response>,
): typeof fetch {
  return (async (_url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { id?: number; method: string };
    const handler = handlers[body.method];
    if (handler === undefined) {
      // notifications expect no body, just an accepted status
      return new Response(null, { status: 202 });
    }
    return handler(body.id ?? 0);
  }) as typeof fetch;
}

describe('Streamable HTTP transport', () => {
  it('performs the handshake, echoes the session id and lists tools', async () => {
    const seenUrls: string[] = [];
    const seenSession: (string | undefined)[] = [];
    const fetchImpl = makeHandler({
      initialize: (id) =>
        jsonRpcResponse(id, { protocolVersion: '2025-06-18', capabilities: {} }, { 'mcp-session-id': 'sess-123' }),
      'tools/list': (id) =>
        jsonRpcResponse(id, {
          tools: [{ name: 'search', description: 'Searches', inputSchema: { type: 'object' } }],
        }),
    });
    const instrumented = (async (url: string | URL, init?: RequestInit) => {
      seenUrls.push(String(url));
      seenSession.push(new Headers(init?.headers).get('mcp-session-id') ?? undefined);
      return fetchImpl(url, init);
    }) as typeof fetch;

    const transport = new HttpMcpTransport('https://mcp.example.test/endpoint', {
      headers: { authorization: 'Bearer test' },
      fetchImpl: instrumented,
    });
    const client = new McpClient('fathom', transport);
    await client.connect();
    const tools = await client.listTools();
    expect(tools[0]?.name).toBe('search');
    expect(seenUrls).toEqual([
      'https://mcp.example.test/endpoint',
      'https://mcp.example.test/endpoint',
      'https://mcp.example.test/endpoint',
    ]);
    // [initialize, notifications/initialized, tools/list]: the session id is
    // captured from the initialize response and echoed from then on.
    expect(seenSession).toEqual([undefined, 'sess-123', 'sess-123']);
  });

  it('parses a JSON-RPC result delivered inside an SSE stream', async () => {
    const sse = [
      ': ping',
      'event: message',
      `data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'sse-tool', inputSchema: { type: 'object' } }] } })}`,
      '',
      '',
    ].join('\n');
    const fetchImpl = (async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      if (body.method !== 'tools/list') throw new Error(`unexpected ${body.method}`);
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    const transport = new HttpMcpTransport('https://mcp.example.test/sse', { fetchImpl });
    const client = new McpClient('sse', transport);
    const tools = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['sse-tool']);
  });
});

describe('mcpPlugin', () => {
  it('registers namespaced tools and reports status', async () => {
    const fetchImpl = makeHandler({
      initialize: (id) => jsonRpcResponse(id, {}, { 'mcp-session-id': 's1' }),
      'tools/list': (id) =>
        jsonRpcResponse(id, {
          tools: [{ name: 'search', description: 'Searches', inputSchema: { type: 'object' } }],
        }),
      'tools/call': (id) => jsonRpcResponse(id, { content: [{ type: 'text', text: 'ok-result' }] }),
    });

    const host = new PluginHost(process.cwd());
    const plugin = mcpPlugin({
      servers: [
        {
          name: 'fathom',
          type: 'remote',
          url: 'https://mcp.example.test/endpoint',
          enabled: true,
          timeoutMs: 5000,
        },
      ],
      fetchImpl,
    });
    host.use(plugin);
    await host.activate();

    expect(host.tools.map((t) => t.name)).toEqual(['mcp__fathom__search']);
    expect(host.permissionFor('mcp__fathom__search')).toBe('network');
    expect(plugin.status()).toEqual([
      { server: 'fathom', type: 'remote', ok: true, tools: 1 },
    ]);
    const tool = host.tools[0]!;
    await expect(tool.execute({ query: 'x' }, { rootDir: process.cwd() })).resolves.toBe('ok-result');

    // a failing server is skipped and reported
    const host2 = new PluginHost(process.cwd());
    const plugin2 = mcpPlugin({
      servers: [{ name: 'broken', type: 'remote', url: 'https://broken.example.test', enabled: true }],
      fetchImpl: (async () => new Response('nope', { status: 500 })) as typeof fetch,
    });
    host2.use(plugin2);
    await host2.activate();
    expect(host2.tools).toHaveLength(0);
    expect(plugin2.status()[0]).toMatchObject({ server: 'broken', ok: false, tools: 0 });
    expect(plugin2.status()[0]?.error).toContain('500');
  });
});

describe('path sanity', () => {
  it('fixture path resolves', () => {
    expect(FIXTURE.endsWith('echo-server.mjs')).toBe(true);
    expect(path.isAbsolute(FIXTURE)).toBe(true);
  });
});
