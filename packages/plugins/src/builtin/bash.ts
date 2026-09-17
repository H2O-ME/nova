import { errMessage } from '@nova-agent/core';
import { existsSync } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ToolExecuteContext } from '@nova-agent/core';
import type { Plugin } from '../types.js';

export interface BashPluginOptions {
  /** Hard cap per command in ms; the model may request less. Default 60000. */
  timeoutMs?: number;
  /** Explicit shell binary override (e.g. "C:\\Program Files\\Git\\bin\\bash.exe"). */
  shellPath?: string;
  /** Max raw output kept in memory before truncation, bytes. Default 256 KiB. */
  maxOutputBytes?: number;
}

/** Default per-command wall clock when the workspace config sets none. */
export const DEFAULT_BASH_TIMEOUT_MS = 60_000;
/** Default in-memory output cap; the same figure the job registry uses per read. */
export const DEFAULT_BASH_OUTPUT_BYTES = 256 * 1024;
/**
 * Grace after the process is gone before settling anyway: the exit event fires
 * before stdio `close`, so we wait briefly for the last buffered output to
 * flush. Shared by the foreground run and the background job (same reason).
 */
const SETTLE_GRACE_MS = 2_000;
/**
 * Backstop after a kill request: a tree kill can leave the pipes open, so
 * neither `close` nor `exit` ever arrives. Settle deterministically after this
 * budget instead of hanging the turn. Shared by the foreground run and jobs.
 */
const KILL_SETTLE_MS = 3_000;

interface ShellInvocation {
  cmd: string;
  args: string[];
}

interface ShellOutcome {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError?: string;
  /** Bytes dropped from the middle of output (head + tail retained). */
  droppedBytes?: number;
}

/**
 * Byte-budgeted stream capture keeping BOTH ends of the output, mirroring the
 * core's tool-result contract (`HEAD_TAIL_RATIO` in core/agent.ts): the head
 * 60% gives the summary, a ring-buffered tail 40% keeps the most recent
 * output — which is where test failures and stack traces live. The old
 * head-only capture silently threw away exactly the part that matters.
 * `dropped` counts the middle bytes that fit neither segment, so callers can
 * report them instead of pretending the output was intact.
 */
export class BudgetedBuffer {
  private head: Buffer[] = [];
  private tail: Buffer[] = [];
  private headBytes = 0;
  private tailBytes = 0;
  private droppedBytes_ = 0;
  private readonly headBudget: number;
  private readonly tailBudget: number;
  /**
   * Carries an incomplete trailing UTF-8 sequence across drains: jobs reads
   * split output at arbitrary read boundaries, and without decoder state a
   * multi-byte char (CJK, emoji) spanning two reads would surface as two
   * replacement glyphs instead of one char on the second read.
   */
  private readonly decoder = new StringDecoder('utf8');

  constructor(maxBytes: number) {
    this.headBudget = Math.floor(maxBytes * 0.6);
    this.tailBudget = maxBytes - this.headBudget;
  }

  get dropped(): number {
    return this.droppedBytes_;
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    let remaining = chunk;
    if (this.headBytes < this.headBudget) {
      const take = remaining.subarray(0, this.headBudget - this.headBytes);
      this.headBytes += take.length;
      this.head.push(take);
      if (take.length >= remaining.length) return;
      remaining = remaining.subarray(take.length);
    }
    // Ring-buffer the tail: evict the oldest tail bytes until the new chunk
    // fits (an eviction IS a middle byte: the head is full, the tail front
    // is no longer "most recent").
    while (remaining.length > this.tailBudget - this.tailBytes && this.tail.length > 0) {
      const front = this.tail.shift()!;
      this.tailBytes -= front.length;
      this.droppedBytes_ += front.length;
    }
    const space = this.tailBudget - this.tailBytes;
    if (remaining.length > space) {
      // A single chunk larger than the whole tail budget (a big pipe burst):
      // keep the chunk's END — the newest bytes are the ones that matter.
      const keep = Math.min(remaining.length, space);
      const start = remaining.length - keep;
      this.tail.push(remaining.subarray(start));
      this.tailBytes += keep;
      this.droppedBytes_ += remaining.length - keep;
    } else {
      this.tail.push(remaining);
      this.tailBytes += remaining.length;
    }
  }

  concat(): string {
    return Buffer.concat([...this.head, ...this.tail]).toString('utf8');
  }

  /**
   * Return the accumulated output AND drain it: subsequent reads see only new
   * output (the `jobs` tool contract — action=output reads since last read).
   * Decoded through the held StringDecoder state; an eviction seam (genuinely
   * dropped middle bytes) can still show a replacement glyph — those bytes no
   * longer exist.
   */
  drain(): { text: string; dropped: number } {
    const text = this.decoder.write(Buffer.concat([...this.head, ...this.tail]));
    const dropped = this.droppedBytes_;
    this.head = [];
    this.tail = [];
    this.headBytes = 0;
    this.tailBytes = 0;
    this.droppedBytes_ = 0;
    return { text, dropped };
  }
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
 * Whether `bash.exe` is resolvable on PATH on Windows — i.e. whether the bash
 * tool will actually run commands through a POSIX shell or fall back to
 * PowerShell. The context fragment reports this SAME resolution so the model
 * writes commands for the shell that will really execute them (a "shell:
 * powershell" declaration while bash.exe runs the command makes every
 * PowerShell-ism fail with a bare non-zero exit).
 */
export function bashOnPath(): boolean {
  if (process.platform !== 'win32') return false;
  const dirs = (process.env['PATH'] ?? '').split(';');
  return dirs.some((dir) => {
    if (dir.trim().length === 0) return false;
    try {
      return existsSync(path.join(dir, 'bash.exe'));
    } catch {
      return false;
    }
  });
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

/**
 * Kill a spawned shell AND its whole child process tree. A bare
 * `child.kill()` only terminates the shell itself — on Windows the spawned
 * grandchildren (vitest under pnpm, node under npm) keep running. POSIX spawns
 * are `detached` (the child leads its own process group), so a negative-pid
 * SIGKILL takes down the whole group in one shot; Windows keeps the taskkill
 * tree kill.
 */
function killShell(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === 'win32') {
    // /T = tree, /F = force. Fire-and-forget: the close event settles the outcome.
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL'); // negative pid = the whole group
  } catch {
    // Group already gone (or the child never became a leader) — fall back.
    child.kill('SIGKILL');
  }
}

/**
 * Child env: force Python's UTF-8 mode so heredoc scripts emit UTF-8 on the
 * GBK-default Windows console — without this every python one-liner needs
 * the `sys.stdout = io.TextIOWrapper(sys.stdout.buffer, …)` boilerplate to
 * avoid UnicodeEncodeError (observed 40+ times in one session). Inherited
 * otherwise; harmless on POSIX.
 */
function childEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
}

function runOnce(
  inv: ShellInvocation,
  rootDir: string,
  timeoutMs: number,
  maxOutputBytes: number,
  signal?: AbortSignal,
  onOutput?: (text: string) => void,
): Promise<ShellOutcome> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(inv.cmd, inv.args, {
        cwd: rootDir,
        env: childEnv(),
        windowsHide: true,
        // POSIX: the child leads its own process group, so killShell's negative-pid
        // SIGKILL reaches the whole tree; Windows keeps taskkill /T /F.
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve({ code: null, stdout: '', stderr: '', spawnError: errMessage(err) });
      return;
    }

    const stdoutBuf = new BudgetedBuffer(maxOutputBytes);
    const stderrBuf = new BudgetedBuffer(maxOutputBytes);
    // Streaming decoders: a UTF-8 char split across pipe chunks must not
    // reach the progress feed as replacement glyphs.
    const outDecoder = new StringDecoder('utf8');
    const errDecoder = new StringDecoder('utf8');
    const feed = (text: string): void => {
      if (text.length > 0) onOutput?.(text);
    };

    let settled = false;
    let exitCode: number | null = null;
    let killed = false;
    let closeGrace: NodeJS.Timeout | undefined;
    let killSettle: NodeJS.Timeout | undefined;
    let timer: NodeJS.Timeout | undefined;

    /**
     * The single settle point. On Windows a tree-kill can leave the stdio
     * pipes open (MSYS grandchildren escape the taskkill snapshot), and the
     * `close` event may then never fire — waiting on it alone hangs the tool
     * forever (observed: a killed command reported as running for 13+ min).
     * We destroy the pipes ourselves and settle with whatever output was
     * collected; `exit` alone is enough to decide the outcome.
     */
    const finish = (spawnError?: string): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (closeGrace !== undefined) clearTimeout(closeGrace);
      if (killSettle !== undefined) clearTimeout(killSettle);
      signal?.removeEventListener('abort', onAbort);
      child.stdout?.destroy();
      child.stderr?.destroy();
      const droppedBytes = stdoutBuf.dropped + stderrBuf.dropped;
      resolve({
        code: exitCode,
        stdout: stdoutBuf.concat(),
        stderr: stderrBuf.concat(),
        ...(droppedBytes > 0 ? { droppedBytes } : {}),
        ...(spawnError !== undefined ? { spawnError } : {}),
      });
    };

    const kill = (): void => {
      killed = true;
      killShell(child);
      // If the tree kill leaves the pipes open, neither `close` nor even
      // `exit` may arrive in time — settle deterministically right after.
      killSettle ??= setTimeout(() => finish(), KILL_SETTLE_MS);
    };

    timer = setTimeout(() => kill(), timeoutMs);
    const onAbort = () => kill();
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout?.on('data', (chunk: Buffer) => {
      // Decode BEFORE the storage cap: progress display stays live even for
      // commands whose output already exceeded maxOutputBytes.
      feed(outDecoder.write(chunk));
      stdoutBuf.push(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      feed(errDecoder.write(chunk));
      stderrBuf.push(chunk);
    });
    child.on('error', (err: NodeJS.ErrnoException) => {
      finish(`${err.code ?? 'ERROR'}: ${err.message}`);
    });
    child.on('exit', (code) => {
      // Process is dead — the outcome is decided. Give `close` a short grace
      // to flush the last buffered output, then finish regardless. A killed
      // process reports exit code 1 on Windows — report null instead so the
      // result reads as "did not exit", not as a command that failed.
      exitCode = killed ? null : code;
      closeGrace = setTimeout(() => finish(), SETTLE_GRACE_MS);
    });
    child.on('close', (code) => {
      exitCode = killed ? null : (code ?? exitCode);
      finish();
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
 * Prefix for the "middle bytes hidden" notice bash reports on truncation.
 * Kept short so it never hides the head it annotates.
 */
const TRUNCATE_HINT = '[nova: output truncated] ';

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
      env: childEnv(),
      windowsHide: true,
      // POSIX: the child leads its own process group, so killShell's negative-pid
      // SIGKILL reaches the whole tree; Windows keeps taskkill /T /F.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    return errMessage(err);
  }

  const buf = new BudgetedBuffer(outputLimitBytes);
  let killed = false;

  const collect = (chunk: Buffer): void => {
    buf.push(chunk);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);

  let resolvedDone = false;
  let exitCode: number | null = null;
  let killSettle: NodeJS.Timeout | undefined;
  /**
   * The single settle point, mirroring runOnce's Windows defense: a tree kill
   * can leave the stdio pipes held by MSYS grandchildren that escaped the
   * taskkill snapshot, and the `close` event then never fires — waiting on it
   * alone hangs `done` forever, which hangs `jobs.dispose()` at session
   * teardown. Settle on `exit` after a short flush grace, or right after the
   * kill; destroy the pipes ourselves.
   */
  const settle = (outcome: { status: 'completed' | 'killed' | 'failed'; detail?: string }): void => {
    if (resolvedDone) return;
    resolvedDone = true;
    if (killSettle !== undefined) clearTimeout(killSettle);
    child.stdout?.destroy();
    child.stderr?.destroy();
    resolveDone(outcome);
  };
  const describeExit = (): { status: 'completed' | 'killed' | 'failed'; detail?: string } =>
    killed
      ? { status: 'killed', detail: `exit code: ${exitCode ?? 'null'}` }
      : exitCode === 0
        ? { status: 'completed', detail: 'exit code: 0' }
        : exitCode === null
          ? { status: 'failed', detail: 'command did not exit cleanly' }
          : { status: 'failed', detail: `exit code: ${exitCode}` };

  let resolveDone: (outcome: { status: 'completed' | 'killed' | 'failed'; detail?: string }) => void = () => {};
  const done = new Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string }>((resolve) => {
    resolveDone = resolve;
  });
  child.on('error', (err: NodeJS.ErrnoException) => {
    settle({ status: 'failed', detail: `${err.code ?? 'ERROR'}: ${err.message}` });
  });
  child.on('exit', (code) => {
    // Process is dead — the outcome is decided; `close` gets a short grace to
    // flush the last buffered output, then we settle regardless.
    exitCode = killed ? null : code;
    killSettle ??= setTimeout(() => settle(describeExit()), SETTLE_GRACE_MS);
  });
  child.on('close', (code) => {
    exitCode = killed ? null : (code ?? exitCode);
    settle(describeExit());
  });

  return {
    done,
    cancel: () => {
      if (killed) return;
      killed = true;
      killShell(child);
      // If the tree kill leaves the pipes open, even `exit` may not arrive
      // in time — settle deterministically right after.
      killSettle ??= setTimeout(() => settle(describeExit()), KILL_SETTLE_MS);
    },
    readOutput: () => {
      const { text, dropped } = buf.drain();
      // A truncated tail is the norm for chatty builds; say so once instead of
      // silently returning the head+tail splice as if it were complete.
      return dropped > 0 ? `${TRUNCATE_HINT}${dropped} bytes kept out of view.\n${text}` : text;
    },
  };
}

/**
 * Run a foreground bash command or start a detached job (run_in_background).
 * Shared by every caller that drives the bash tool — extracted so the plugin
 * factory body is only schema + wiring.
 */
async function executeBash(
  args: Record<string, unknown>,
  c: ToolExecuteContext,
  defaultTimeoutMs: number,
  maxOutputBytes: number,
  shellPath: string | undefined,
): Promise<string> {
  const command = typeof args['command'] === 'string' ? args['command'] : '';
  if (command.trim().length === 0) return 'Error: command is required';
  const requested = typeof args['timeout_ms'] === 'number' ? Math.trunc(args['timeout_ms']) : undefined;
  const timeoutMs = Math.min(Math.max(1000, requested ?? defaultTimeoutMs), Math.max(1000, defaultTimeoutMs));

  if (args['run_in_background'] === true) {
    if (c.jobs === undefined) return 'Error: background jobs are not available in this context';
    // Pre-check with the SAME resolution declaredShell reports: a
    // missing bash.exe surfaces as an async ENOENT event, too late
    // for a fallback — so pick PowerShell up front.
    let inv =
      process.platform === 'win32' && shellPath === undefined && !bashOnPath()
        ? powershellInvocation(command)
        : invocation(command, shellPath);
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
    return `Started background job ${snapshot.id}: ${command}\nYou will be notified automatically when it finishes — do not poll. When notified, read its output once with the jobs tool (action=output, id=${snapshot.id}); use action=stop to terminate it early.`;
  }

  // Long-running commands stream their raw output to the UI as it
  // arrives, so the tool line can show a live tail instead of looking
  // frozen until the process exits.
  const onOutput = c.onProgress !== undefined ? (text: string): void => c.onProgress?.(text) : undefined;
  let inv = invocation(command, shellPath);
  let outcome = await runOnce(inv, c.rootDir, timeoutMs, maxOutputBytes, c.signal, onOutput);
  if (outcome.spawnError !== undefined && process.platform === 'win32') {
    // No Git Bash on PATH: fall back to PowerShell.
    inv = powershellInvocation(command);
    outcome = await runOnce(inv, c.rootDir, timeoutMs, maxOutputBytes, c.signal, onOutput);
  }
  if (outcome.spawnError !== undefined) {
    return `Error: cannot spawn shell (${inv.cmd}): ${outcome.spawnError}`;
  }

  const parts: string[] = [];
  if (outcome.code === null) parts.push('[command did not exit: killed after timeout or aborted]');
  parts.push(`exit: ${outcome.code ?? 'null'}`);
  if (outcome.droppedBytes !== undefined) {
    parts.push(`[stdout/stderr truncated: ${outcome.droppedBytes} bytes in the middle kept out of view]`);
  }
  parts.push(`stdout:\n${outcome.stdout.length > 0 ? outcome.stdout : '(empty)'}`);
  if (outcome.stderr.length > 0) parts.push(`stderr:\n${outcome.stderr}`);
  return parts.join('\n');
}

export function bashPlugin(options?: BashPluginOptions): Plugin {
  const defaultTimeoutMs = options?.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS;
  const maxOutputBytes = options?.maxOutputBytes ?? DEFAULT_BASH_OUTPUT_BYTES;

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
        execute: (args, c) => executeBash(args, c, defaultTimeoutMs, maxOutputBytes, options?.shellPath),
      }, { permission: 'execute' });
    },
  };
}
