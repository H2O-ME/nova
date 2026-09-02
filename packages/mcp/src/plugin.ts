import type { ToolExecuteContext } from '@nova-agent/core';
import type { Plugin, PluginContext } from '@nova-agent/plugins';
import { McpClient } from './client.js';
import { HttpMcpTransport } from './http.js';
import { StdioMcpTransport } from './stdio.js';
import type { McpServerConfig } from './config.js';

export interface McpServerStatus {
  server: string;
  type: 'stdio' | 'remote';
  ok: boolean;
  tools: number;
  error?: string;
}

export interface McpPluginOptions {
  servers: McpServerConfig[];
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  clientName?: string;
}

export interface McpPlugin extends Plugin {
  status(): McpServerStatus[];
  /**
   * Connect every not-yet-connected server on demand. The first call happens
   * at activation; runners call it again before later turns so a server that
   * failed (transient network, slow boot) retries instead of being dead for
   * the whole session. Already-connected servers are skipped.
   */
  ensureConnected(): Promise<void>;
  /** Disconnect stdio servers; safe to call at process exit. */
  close(): Promise<void>;
}

/**
 * Registers each server's tools as `mcp__<server>__<tool>` (GOALS §6) so they
 * schedule and pass through the approval gate exactly like local tools.
 * stdio tools need `execute` clearance; remote tools count as `network`.
 * Connection is deferred: a server that fails to start is reported via
 * status() and retried on the next ensureConnected(), never blocking boot.
 */
export function mcpPlugin(options: McpPluginOptions): McpPlugin {
  let context: PluginContext | undefined;
  const statuses = new Map<string, McpServerStatus>();
  const connected = new Set<string>();
  const disposables: Array<{ close(): Promise<void> }> = [];

  const connectServer = async (server: McpServerConfig): Promise<void> => {
    if (context === undefined) throw new Error('mcp plugin used before activation');
    const status: McpServerStatus = statuses.get(server.name) ?? {
      server: server.name,
      type: server.type,
      ok: false,
      tools: 0,
    };
    statuses.set(server.name, status);
    status.ok = false;
    status.error = undefined;
    status.tools = 0;
    try {
      const transport =
        server.type === 'stdio'
          ? new StdioMcpTransport(server.command, {
              ...(server.args !== undefined ? { args: server.args } : {}),
              ...(server.env !== undefined ? { env: server.env } : {}),
              ...(server.cwd !== undefined ? { cwd: server.cwd } : {}),
            })
          : new HttpMcpTransport(server.url, {
              ...(server.headers !== undefined ? { headers: server.headers } : {}),
              ...(options.fetchImpl !== undefined ? { fetchImpl: options.fetchImpl } : {}),
            });
      disposables.push(transport);
      const client = new McpClient(server.name, transport, {
        ...(options.clientName !== undefined ? { clientName: options.clientName } : {}),
        ...(server.timeoutMs !== undefined ? { toolTimeoutMs: server.timeoutMs } : {}),
      });
      await client.connect();
      const tools = await client.listTools();
      for (const tool of tools) {
        context.registerTool(
          {
            name: `mcp__${server.name}__${tool.name}`,
            description: tool.description ?? `MCP tool "${tool.name}" from server "${server.name}".`,
            parameters: tool.inputSchema,
            async execute(args: Record<string, unknown>, c: ToolExecuteContext) {
              const result = await client.callTool(tool.name, args, { signal: c.signal });
              return result.isError ? `Error: ${result.text}` : result.text;
            },
          },
          { permission: server.type === 'remote' ? 'network' : 'execute' },
        );
      }
      disposables.push(client);
      status.ok = true;
      status.tools = tools.length;
    } catch (err) {
      status.error = err instanceof Error ? err.message : String(err);
    }
  };

  const plugin: McpPlugin = {
    name: 'mcp',
    description: 'Model Context Protocol servers (stdio + Streamable HTTP remote).',
    async activate(ctx) {
      context = ctx;
      await plugin.ensureConnected();
    },
    async ensureConnected() {
      for (const server of options.servers) {
        if (connected.has(server.name)) continue;
        await connectServer(server);
        if (statuses.get(server.name)?.ok === true) connected.add(server.name);
      }
    },
    status() {
      return [...statuses.values()].map((entry) => ({ ...entry }));
    },
    async close() {
      for (const disposable of disposables.splice(0)) {
        await disposable.close().catch(() => undefined);
      }
    },
  };
  return plugin;
}
