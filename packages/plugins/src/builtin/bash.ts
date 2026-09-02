import { spawn } from 'node:child_process';
import type { JobStart, ToolExecuteContext } from '@nova-agent/core';
import type { Plugin } from '../types.js';

export interface BashPluginOptions {
  /** Hard cap per command in ms; the model may request less. Default 60000. */
  timeoutMs?: number;
  /** Explicit shell binary override (e.g. "C:\\Program Files\\Git\\bin\\bash.exe"). */
  shellPath?: string;
  /** Max raw output kept in memory before truncation, bytes. Default 256 KiB. */
  maxOutputBytes?: number;
}

interface ShellInvocation {
  cmd: string;
  args: string[];
}

interface ShellOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
}

/** Prefer a POSIX shell (Git Bash) on Windows; fall back to PowerShell. */
function invocation(command: string, shellPath?: string): ShellInvocation {
  if (shellPath !== undefined && shellPath.length > 0) {
    return { cmd: shellPath, args: ['-c', command] };
  }
  if (process.platform === 'win32') {
    return { cmd: 'bash.exe', args: ['-c', command] };
  }
  return { cmd: 'bash', args: ['-c', command] };
}

/**
 * Windows PowerShell defaults to the legacy console codepage (e.g. GBK on
 * zh-CN systems), which garbles non-ASCII output read as UTF-8. Prepending
 * this statement (codex's approach) forces UTF-8 for the whole invocation.
 */
export const POWERSHELL_UTF8_PREFIX =
  'try { [Console]::OutputEncoding=[System.Text.Encoding]::UTF8 } catch {}';

export function powershellInvocation(command: string): ShellInvocation {
  return {
    cmd: 'powershell.exe',
    args: ['-NoProfile', '-Command', `${POWERSHELL_UTF8_PREFIX}\n${command}`],
  };
}

function runOnce(
  inv: ShellInvocation,
  rootDir: string,
  timeoutMs: number,
  maxOutputBytes: number,
  signal?: AbortSignal,
): Promise<ShellOutcome> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(inv.cmd, inv.args, {
        cwd: rootDir,
        env: process.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ code: null, stdout: '', stderr: '', spawnError: err instanceof Error ? err.message : String(err) });
      return;
    }

    let collected = 0;
    let errCollected = 0;
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];

    const timer = setTimeout(() => child.kill(), timeoutMs);
    const onAbort = () => child.kill();
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      if (collected >= maxOutputBytes) return;
      const take = chunk.subarray(0, maxOutputBytes - collected);
      collected += take.length;
      chunks.push(take);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (errCollected >= maxOutputBytes) return;
      const take = chunk.subarray(0, maxOutputBytes - errCollected);
      errCollected += take.length;
      errChunks.push(take);
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({ code: null, stdout: '', stderr: '', spawnError: `${err.code ?? 'ERROR'}: ${err.message}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve({
        code,
        stdout: Buffer.concat(chunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
      });
    });
  });
}

interface BackgroundHandle {
  /** Resolves with the process exit outcome after resources are released. */
  done: Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string }>;
  cancel: (reason?: string) => void;
  readOutput: () => string;
}

/**
 * Spawn a detached background job: stdout/stderr stream into a byte-capped
 * buffer, cancel is a synchronous idempotent kill, and `done` settles only
 * after the process exits and its resources are released (dsh jobs contract).
 * Returns an error string when the shell binary cannot be spawned.
 */
function startBackground(
  inv: ShellInvocation,
  rootDir: string,
  outputLimitBytes: number,
): BackgroundHandle | string {
  let child;
  try {
    child = spawn(inv.cmd, inv.args, {
      cwd: rootDir,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }

  const chunks: Buffer[] = [];
  let collected = 0;
  let killed = false;

  const collect = (chunk: Buffer): void => {
    if (collected >= outputLimitBytes) return;
    const take = chunk.subarray(0, outputLimitBytes - collected);
    collected += take.length;
    chunks.push(take);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  let resolveDone: (outcome: { status: 'completed' | 'killed' | 'failed'; detail?: string }) => void = () => {};
  const done = new Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string }>((resolve) => {
    resolveDone = resolve;
  });
  child.on('error', (err: NodeJS.ErrnoException) => {
    resolveDone({ status: 'failed', detail: `${err.code ?? 'ERROR'}: ${err.message}` });
  });
  child.on('close', (code) => {
    resolveDone(
      killed
        ? { status: 'killed', detail: `exit code: ${code ?? 'null'}` }
        : code === 0
          ? { status: 'completed', detail: 'exit code: 0' }
          : code === null
            ? { status: 'failed', detail: 'command did not exit cleanly' }
            : { status: 'failed', detail: `exit code: ${code}` },
    );
  });

  return {
    done,
    cancel: () => {
      if (killed) return;
      killed = true;
      child.kill();
    },
    readOutput: () => Buffer.concat(chunks.splice(0)).toString('utf8'),
  };
}

export function bashPlugin(options?: BashPluginOptions): Plugin {
  const defaultTimeoutMs = options?.timeoutMs ?? 60_000;
  const maxOutputBytes = options?.maxOutputBytes ?? 256 * 1024;

  return {
    name: 'bash',
    description: 'Run shell commands in the workspace root (POSIX shell on Windows via Git Bash, PowerShell fallback).',
    activate(ctx) {
      ctx.registerTool({
        name: 'bash',
        description:
          'Runs a shell command in the workspace root. Args: command (required), timeout_ms (optional, capped by configuration), run_in_background (optional boolean; returns a job handle instead of waiting). Returns exit code plus captured stdout/stderr. Use for git, pnpm, tests, etc.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to run.' },
            timeout_ms: { type: 'number', description: 'Optional timeout in milliseconds.' },
            run_in_background: {
              type: 'boolean',
              description: 'Start detached and return a job id immediately; read progress with the jobs tool.',
            },
          },
          required: ['command'],
          additionalProperties: false,
        },
        async execute(args, c: ToolExecuteContext) {
          const command = typeof args['command'] === 'string' ? args['command'] : '';
          if (command.trim().length === 0) return 'Error: command is required';
          const requested = typeof args['timeout_ms'] === 'number' ? Math.trunc(args['timeout_ms']) : undefined;
          const timeoutMs = Math.min(Math.max(1000, requested ?? defaultTimeoutMs), Math.max(1000, defaultTimeoutMs));

          if (args['run_in_background'] === true) {
            if (c.jobs === undefined) return 'Error: background jobs are not available in this context';
            const inv = invocation(command, options?.shellPath);
            const handle = startBackground(inv, c.rootDir, maxOutputBytes);
            if (typeof handle === 'string') return `Error: cannot spawn shell (${inv.cmd}): ${handle}`;
            const snapshot = c.jobs.start({
              kind: 'bash',
              label: command,
              outputLimitBytes: maxOutputBytes,
              cancel: handle.cancel,
              done: handle.done,
              readOutput: handle.readOutput,
            });
            return `Started background job ${snapshot.id}: ${command}\nUse the jobs tool (action=output, id=${snapshot.id}) to poll output, or action=stop to terminate it.`;
          }

          let inv = invocation(command, options?.shellPath);
          let outcome = await runOnce(inv, c.rootDir, timeoutMs, maxOutputBytes, c.signal);
          if (outcome.spawnError !== undefined && process.platform === 'win32') {
            // No Git Bash on PATH: fall back to PowerShell.
            inv = powershellInvocation(command);
            outcome = await runOnce(inv, c.rootDir, timeoutMs, maxOutputBytes, c.signal);
          }
          if (outcome.spawnError !== undefined) {
            return `Error: cannot spawn shell (${inv.cmd}): ${outcome.spawnError}`;
          }

          const parts: string[] = [];
          if (outcome.code === null) parts.push('[command did not exit: killed after timeout or aborted]');
          parts.push(`exit: ${outcome.code ?? 'null'}`);
          parts.push(`stdout:\n${outcome.stdout.length > 0 ? outcome.stdout : '(empty)'}`);
          if (outcome.stderr.length > 0) parts.push(`stderr:\n${outcome.stderr}`);
          return parts.join('\n');
        },
      }, { permission: 'execute' });
    },
  };
}
