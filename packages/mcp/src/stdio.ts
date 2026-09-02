import { spawn, type ChildProcess } from 'node:child_process';
import { McpError, abortError, unwrapResponse, type McpRequestOptions, type McpTransport } from './protocol.js';

export interface StdioTransportOptions {
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Injectable for tests; defaults to node child_process.spawn. */
  spawnImpl?: typeof spawn;
}

/**
 * MCP stdio transport: one JSON-RPC message per newline on the child's
 * stdin/stdout (spec: 2025-06-18 basic/transports#stdio). stderr is captured
 * (tail kept) so server-side startup failures produce useful errors.
 * On Windows .cmd shims (npx, uvx) cannot be spawned directly, so commands
 * run through `cmd /c`.
 */
export class StdioMcpTransport implements McpTransport {
  private readonly child: ChildProcess;
  private nextId = 0;
  private readonly pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private buffer = '';
  private stderrTail = '';
  private closed = false;

  constructor(command: string, options: StdioTransportOptions = {}) {
    const spawnImpl = options.spawnImpl ?? spawn;
    if (process.platform === 'win32') {
      this.child = spawnImpl('cmd.exe', ['/c', command, ...(options.args ?? [])], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } else {
      this.child = spawnImpl(command, options.args ?? [], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    this.child.stdout?.setEncoding('utf8');
    this.child.stdout?.on('data', (chunk: string) => this.onStdout(chunk));
    this.child.stderr?.setEncoding('utf8');
    this.child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-2000);
    });
    this.child.on('error', (err) => this.failAll(new McpError(`cannot spawn "${command}": ${err.message}`)));
    this.child.on('close', (code) => {
      this.failAll(new McpError(`MCP server "${command}" exited (code ${code ?? 'null'})${this.stderrTail.trim().length > 0 ? `: ${this.stderrTail.trim().slice(-500)}` : ''}`));
    });
  }

  private onStdout(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line.length > 0) this.handleLine(line);
      newline = this.buffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // non-JSON line: tolerate chatty servers
    }
    if (msg === null || typeof msg !== 'object') return;
    const id = (msg as { id?: unknown }).id;
    if (typeof id !== 'number') return; // notification or unrelated request
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    try {
      pending.resolve(unwrapResponse(msg as Parameters<typeof unwrapResponse>[0]));
    } catch (err) {
      pending.reject(err instanceof Error ? err : new McpError(String(err)));
    }
  }

  private failAll(err: Error): void {
    this.closed = true;
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }

  async request(method: string, params: unknown, opts?: McpRequestOptions): Promise<unknown> {
    if (this.closed) throw new McpError('MCP stdio server is not running');
    const id = ++this.nextId;
    const timeoutMs = opts?.timeoutMs ?? 10_000;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      opts?.signal?.addEventListener(
        'abort',
        () => {
          if (!this.pending.has(id)) return;
          clearTimeout(timer);
          this.pending.delete(id);
          reject(abortError());
        },
        { once: true },
      );
      this.writeLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  async notify(method: string, params?: unknown): Promise<void> {
    if (this.closed) throw new McpError('MCP stdio server is not running');
    this.writeLine(JSON.stringify({ jsonrpc: '2.0', method, ...(params !== undefined ? { params } : {}) }));
  }

  private writeLine(line: string): void {
    // Write failures surface via the child 'error'/'close' handlers, which
    // reject every pending request.
    this.child.stdin?.write(`${line}\n`);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.child.stdin?.end();
    // Give the server a moment to exit on stdin close, then force-kill.
    const exited = new Promise<void>((resolve) => {
      if (this.child.exitCode !== null) {
        resolve();
        return;
      }
      this.child.once('close', () => resolve());
    });
    const forceKill = setTimeout(() => this.child.kill(), 2000);
    await exited;
    clearTimeout(forceKill);
  }
}
