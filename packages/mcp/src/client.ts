import {
  MCP_PROTOCOL_VERSION,
  McpError,
  type McpRequestOptions,
  type McpToolInfo,
  type McpToolResult,
  type McpTransport,
} from './protocol.js';

export interface McpClientOptions {
  clientName?: string;
  clientVersion?: string;
  /** Timeout for initialize / tools/list. Default 10s. */
  requestTimeoutMs?: number;
  /** Timeout for tools/call (tools can be long-running). Default 120s. */
  toolTimeoutMs?: number;
}

interface ContentBlock {
  type: string;
  text?: string;
}

/**
 * Minimal MCP client session: initialize handshake, tools/list, tools/call.
 * Transport-agnostic (stdio and Streamable HTTP both satisfy McpTransport).
 */
export class McpClient {
  private readonly requestTimeoutMs: number;
  private readonly toolTimeoutMs: number;

  constructor(
    readonly serverName: string,
    private readonly transport: McpTransport,
    private readonly options: McpClientOptions = {},
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.toolTimeoutMs = options.toolTimeoutMs ?? 120_000;
  }

  async connect(): Promise<void> {
    const result = (await this.transport.request(
      'initialize',
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: this.options.clientName ?? 'nova-agent',
          version: this.options.clientVersion ?? '0.1.0',
        },
      },
      { timeoutMs: this.requestTimeoutMs },
    )) as { protocolVersion?: string } | undefined;
    if (result !== null && typeof result === 'object' && typeof result.protocolVersion === 'string') {
      // v1 accepts whatever the server negotiates; only major mismatches matter
      // and servers reject those during initialize itself.
    }
    await this.transport.notify('notifications/initialized');
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.transport.request('tools/list', {}, { timeoutMs: this.requestTimeoutMs })) as
      | { tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }> }
      | undefined;
    return (result?.tools ?? []).map((tool) => ({
      name: tool.name,
      ...(tool.description !== undefined ? { description: tool.description } : {}),
      inputSchema: tool.inputSchema ?? { type: 'object' },
    }));
  }

  async callTool(name: string, args: Record<string, unknown>, opts?: McpRequestOptions): Promise<McpToolResult> {
    const options: McpRequestOptions = {
      timeoutMs: opts?.timeoutMs ?? this.toolTimeoutMs,
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
    };
    const result = (await this.transport.request('tools/call', { name, arguments: args }, options)) as
      | { content?: ContentBlock[]; isError?: boolean }
      | undefined;
    const blocks = result?.content ?? [];
    const textParts: string[] = [];
    let nonText = 0;
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') {
        textParts.push(block.text);
      } else {
        nonText += 1;
      }
    }
    let text = textParts.join('\n');
    if (nonText > 0) text += `${text.length > 0 ? '\n' : ''}[${nonText} non-text content block(s) omitted]`;
    return { text, isError: result?.isError === true };
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

export { McpError };
