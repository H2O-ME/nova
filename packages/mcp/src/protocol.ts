/**
 * JSON-RPC 2.0 message shapes shared by both MCP transports, plus the
 * transport contract the McpClient is built on. Transports own request
 * correlation: `request()` resolves with the matching result or throws.
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  text: string;
  isError: boolean;
}

export interface McpRequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface McpTransport {
  /** Send a JSON-RPC request; resolves with `result` or throws McpError. */
  request(method: string, params: unknown, opts?: McpRequestOptions): Promise<unknown>;
  /** Send a notification (no id, no response expected). */
  notify(method: string, params?: unknown): Promise<void>;
  close(): Promise<void>;
}

export class McpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponseLike {
  id?: number | string | null;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

/** Convert a JSON-RPC response object into a result or an McpError. */
export function unwrapResponse(response: JsonRpcResponseLike): unknown {
  if (response.error) {
    throw new McpError(response.error.message || `MCP error ${response.error.code}`, response.error.code);
  }
  return response.result;
}

export function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

export function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}
