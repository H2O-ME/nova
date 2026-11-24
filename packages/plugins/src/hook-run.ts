/**
 * Executing ONE configured hook: variable expansion, the Claude-compatible
 * stdin (including the transient transcript), stdout capture with a byte cap,
 * timeout / cancellation, and exit-code classification.
 *
 * This is the only place that spawns a hook process. Everything above deals in
 * `HookDefinition` values and `HookRunOutcome` results, so the wire details
 * (argv vs shell, the two timeout spellings, transcript files) live here once.
 *
 * Semantics ported from ZCode (`apps/zcode-cli/packages/core/src/hooks/`,
 * Apache-2.0, © Z.ai): `configured-runner-input.ts` for stdin + variables,
 * `configured-runner-callback.ts` for exit-code classification.
 *
 * ## Why the environment variables exist
 *
 * A pack's hooks.json is written against the host that shipped it, so paths
 * must resolve the same way there and here. The FULL ZCode variable set is
 * expanded, because packs use it: `${ZCODE_PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_ROOT}`
 * (pack root), `${ZCODE_PLUGIN_DATA}` / `${CLAUDE_PLUGIN_DATA}` (its writable
 * data dir), `${ZCODE_PROJECT_DIR}` / `${CLAUDE_PROJECT_DIR}` (workspace root),
 * and `${ZCODE_SESSION_ID}` / `${CLAUDE_SESSION_ID}` / `${CLAUDE_CODE_SESSION_ID}`.
 *
 * `${ZCODE_SKILL_DIR}` / `${CLAUDE_SKILL_DIR}` THROW: a hook has no "current
 * skill", and expanding them to the empty string would point a script at `/`.
 * ZCode made the same call; the error names the variable.
 *
 * Expansion applies to the COMMAND and ARGS strings only, never as shell
 * evaluation. An unknown `${...}` is left VERBATIM.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_HOOK_MAX_OUTPUT_BYTES,
  DEFAULT_HOOK_TIMEOUT_MS,
  parseHookOutput,
  serializeHookPayload,
  type HookDefinition,
  type HookPayload,
  type HookRunOutcome,
} from '@nova-agent/core';

/** Where a hook's variables point. */
export interface HookEnvironment {
  /** The pack root a `${*_PLUGIN_ROOT}` reference resolves to, if any. */
  readonly pluginRoot?: string;
  /** The pack's writable data dir (`${*_PLUGIN_DATA}`), if any. */
  readonly pluginData?: string;
  /** The workspace root a `${*_PROJECT_DIR}` reference resolves to. */
  readonly projectDir: string;
  /** The session the hook runs for (`${*_SESSION_ID}`), when there is one. */
  readonly sessionId?: string;
}

/** Variables a hook has no context for; expanding them to "" would be a lie. */
const CONTEXT_ONLY_VARS = new Set(['CLAUDE_SKILL_DIR', 'ZCODE_SKILL_DIR']);

/** The full ZCode variable table for one run. Absent facts are simply not set. */
function hookVars(env: HookEnvironment): Record<string, string> {
  const vars: Record<string, string> = {
    ZCODE_PROJECT_DIR: env.projectDir,
    CLAUDE_PROJECT_DIR: env.projectDir,
    NOVA_PROJECT_DIR: env.projectDir,
  };
  if (env.pluginRoot !== undefined) {
    vars['ZCODE_PLUGIN_ROOT'] = env.pluginRoot;
    vars['CLAUDE_PLUGIN_ROOT'] = env.pluginRoot;
    vars['NOVA_PLUGIN_ROOT'] = env.pluginRoot;
  }
  if (env.pluginData !== undefined) {
    vars['ZCODE_PLUGIN_DATA'] = env.pluginData;
    vars['CLAUDE_PLUGIN_DATA'] = env.pluginData;
    vars['NOVA_PLUGIN_DATA'] = env.pluginData;
  }
  if (env.sessionId !== undefined) {
    vars['ZCODE_SESSION_ID'] = env.sessionId;
    vars['CLAUDE_SESSION_ID'] = env.sessionId;
    vars['CLAUDE_CODE_SESSION_ID'] = env.sessionId;
  }
  return vars;
}

/**
 * Expand `${VAR}` references in one string.
 *
 * A context-only variable (`${ZCODE_SKILL_DIR}`) throws: silently emptying it
 * would hand a script `/` where it expected a directory. Every other unknown
 * reference is left verbatim — a shell wrapper's own `${BASH_SOURCE}` must
 * survive.
 * @returns the expanded string.
 */
export function expandHookVars(
  text: string,
  env: HookEnvironment,
  extra: Readonly<Record<string, string>> = {},
): string {
  const vars = { ...hookVars(env), ...extra };
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => {
    if (CONTEXT_ONLY_VARS.has(name)) {
      throw new Error(`hook variable ${'${'}${name}} needs a skill context, which a hook does not have`);
    }
    return Object.prototype.hasOwnProperty.call(vars, name) ? (vars[name] as string) : whole;
  });
}

/** The timeout a definition asks for: `timeoutMs` wins, then `timeout` (seconds), then the default. */
export function hookTimeoutMs(def: HookDefinition, defaultTimeoutMs: number): number {
  if (def.timeoutMs !== undefined) return Math.max(1, Math.round(def.timeoutMs));
  if (def.type === 'command' && def.timeout !== undefined) return Math.max(1, Math.round(def.timeout * 1000));
  return Math.max(1, Math.round(defaultTimeoutMs));
}

/** Whether a definition runs fire-and-forget (only `command` supports it). */
export function hookIsAsync(def: HookDefinition): boolean {
  return def.type === 'command' && def.async === true;
}

/** How the definition is spawned: argv form spawns directly, command form goes through a shell. */
export interface HookSpawnSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: boolean | string;
}

/**
 * Resolve the spawn spec. A `process` definition is always argv (no shell, no
 * re-quoting); a `command` definition runs through the shell it names
 * (`shell: true` = the platform default, a string = that shell's path), which
 * is what a Claude-compatible hook line expects.
 */
export function hookSpawnSpec(
  def: HookDefinition,
  env: HookEnvironment,
  extra?: Readonly<Record<string, string>>,
): HookSpawnSpec {
  if (def.type === 'process') {
    return {
      command: expandHookVars(def.command, env, extra),
      args: (def.args ?? []).map((arg) => expandHookVars(arg, env, extra)),
      shell: false,
    };
  }
  return {
    command: expandHookVars(def.command, env, extra),
    args: [],
    // `shell: true` means the platform default; a string picks a concrete shell.
    shell: typeof def.shell === 'string' ? def.shell : true,
  };
}

/** Options one hook run needs beyond its definition. */
export interface RunHookOptions {
  readonly env: HookEnvironment;
  readonly payload: HookPayload;
  readonly defaultTimeoutMs?: number;
  readonly maxOutputBytes?: number;
  /** Extra variable values (a pack's `userConfig`, pre-stringified). */
  readonly vars?: Readonly<Record<string, string>>;
  /** Cancellation from the caller (the run was aborted). */
  readonly signal?: AbortSignal;
}

/**
 * The Claude-compatible transcript a hook may read.
 *
 * ZCode has no JSONL transcript of its own, so it writes a temporary one for
 * every hook run: Stop gets the last assistant message, UserPromptSubmit the
 * prompt, everything else an EMPTY but readable file (a hook that opens the
 * path without checking must not crash). The directory is removed when the run
 * settles.
 */
async function createTranscript(input: HookPayload): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nova-hook-'));
  const file = path.join(dir, 'transcript.jsonl');
  let content = '';
  if (input.hookEventName === 'Stop' && input.responseText !== undefined) {
    content = transcriptLine('assistant', input.responseText);
  } else if (input.hookEventName === 'UserPromptSubmit' && input.prompt !== undefined) {
    content = transcriptLine('user', input.prompt);
  }
  await writeFile(file, content, 'utf8');
  return {
    path: file,
    cleanup: async () => {
      await rm(dir, { force: true, recursive: true }).catch(() => undefined);
    },
  };
}

function transcriptLine(role: 'assistant' | 'user', text: string): string {
  return `${JSON.stringify({ message: { content: [{ text, type: 'text' }], role } })}\n`;
}

/**
 * Run one hook and report what came back. NEVER throws: a spawn failure, a
 * timeout, a cancellation, a non-zero exit and an unparseable output are all
 * OUTCOMES, because every caller has to decide what a failed hook means
 * (`onError`) and that decision is not this function's.
 *
 * stdout is capped while streaming (a hook that prints a gigabyte must not
 * exhaust memory), and stderr keeps the first 4 KiB for diagnostics.
 */
export async function runHook(def: HookDefinition, options: RunHookOptions): Promise<HookRunOutcome> {
  const asyncRun = hookIsAsync(def);
  const base: Pick<HookRunOutcome, 'async'> = { async: asyncRun };
  let spec: HookSpawnSpec;
  try {
    spec = hookSpawnSpec(def, options.env, options.vars);
  } catch (err) {
    return {
      ...base,
      exitCode: null,
      stdout: '',
      stderr: '',
      output: undefined,
      failure: err instanceof Error ? err.message : String(err),
      outputError: undefined,
    };
  }

  const timeout = hookTimeoutMs(def, options.defaultTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS);
  const cap = options.maxOutputBytes ?? DEFAULT_HOOK_MAX_OUTPUT_BYTES;
  const transcript = await createTranscript(options.payload).catch(() => undefined);
  const payload: HookPayload = {
    ...options.payload,
    ...(transcript !== undefined ? { transcriptPath: transcript.path } : {}),
  };
  const input = serializeHookPayload(payload);
  const cleanup = async (): Promise<void> => {
    await transcript?.cleanup();
  };

  const outcome = await spawnHook(spec, input, {
    env: options.env,
    vars: options.vars,
    timeout,
    cap,
    asyncRun,
    ...(options.signal !== undefined ? { signal: options.signal } : {}),
  });
  await cleanup();
  return outcome;
}

interface SpawnOptions {
  readonly env: HookEnvironment;
  readonly vars?: Readonly<Record<string, string>>;
  readonly timeout: number;
  readonly cap: number;
  readonly asyncRun: boolean;
  readonly signal?: AbortSignal;
}

function spawnHook(spec: HookSpawnSpec, input: string, options: SpawnOptions): Promise<HookRunOutcome> {
  const { timeout, cap, asyncRun } = options;
  return new Promise<HookRunOutcome>((resolve) => {
    let settled = false;
    let stdout = '';
    let stderr = '';
    let truncated = false;
    let cancellation: string | undefined;

    const finish = (outcome: HookRunOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve(outcome);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(spec.command, [...spec.args], {
        cwd: options.env.projectDir,
        shell: spec.shell,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...process.env,
          ...hookVars(options.env),
          ...options.vars,
        },
      });
    } catch (err) {
      finish({
        async: asyncRun,
        exitCode: null,
        stdout: '',
        stderr: '',
        output: undefined,
        failure: `spawn failed: ${err instanceof Error ? err.message : String(err)}`,
        outputError: undefined,
      });
      return;
    }

    let timeoutFailure: string | undefined;
    const timer = setTimeout(() => {
      timeoutFailure = `timed out after ${timeout}ms`;
      child.kill('SIGKILL');
      // A killed process still has to be reaped; report on `close`, with a
      // bounded fallback for a process that ignores SIGKILL.
      const give = setTimeout(() => finish(buildOutcome()), 500);
      if (typeof give.unref === 'function') give.unref();
    }, timeout);
    if (typeof timer.unref === 'function') timer.unref();

    const onAbort = (): void => {
      // The CALLER cancelled: the hook did not fail, it never got to finish.
      // ZCode distinguishes this from a failure so an interrupt is not recorded
      // as a policy denial.
      cancellation = 'cancelled by the caller';
      child.kill('SIGKILL');
      const give = setTimeout(() => finish(buildOutcome()), 500);
      if (typeof give.unref === 'function') give.unref();
    };
    if (options.signal !== undefined) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk: Buffer) => {
      if (truncated) return;
      const room = cap - Buffer.byteLength(stdout, 'utf8');
      if (room <= 0) {
        truncated = true;
        return;
      }
      const text = chunk.toString('utf8');
      if (Buffer.byteLength(text, 'utf8') <= room) {
        stdout += text;
      } else {
        stdout += Buffer.from(text, 'utf8').subarray(0, room).toString('utf8');
        truncated = true;
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 4096) stderr += chunk.toString('utf8');
    });

    /** The outcome as it stands now — used by every terminal path. */
    const buildOutcome = (exitCode: number | null = null): HookRunOutcome => {
      const trimmedErr = stderr.trim();
      // Parse anyway: a hook that blocked via exit code 2 may also have printed
      // JSON, and the parse result is what the caller applies.
      let output: HookRunOutcome['output'];
      let outputError: string | undefined;
      try {
        output = parseHookOutput(stdout);
      } catch (err) {
        output = undefined;
        outputError = err instanceof Error ? err.message : String(err);
      }
      let failure: string | undefined;
      if (cancellation !== undefined) failure = cancellation;
      else if (timeoutFailure !== undefined) failure = timeoutFailure;
      else if (exitCode !== null && exitCode !== 0 && exitCode !== 2) {
        failure = `exit code ${String(exitCode)}${trimmedErr.length > 0 ? `: ${trimmedErr.slice(0, 1024)}` : ''}`;
      }
      return {
        async: asyncRun,
        exitCode,
        stdout,
        stderr: trimmedErr,
        output,
        failure,
        outputError,
      };
    };

    child.on('error', (err) => {
      finish({
        async: asyncRun,
        exitCode: null,
        stdout,
        stderr: stderr.trim(),
        output: undefined,
        failure: `spawn failed: ${err.message}`,
        outputError: undefined,
      });
    });
    child.on('close', (code) => finish(buildOutcome(code)));

    // One line plus a newline, then EOF: a hook reading to EOF (rather than a
    // line) must not wait forever. A hook that never reads is fine — the write
    // error is ignored and `close` still arrives.
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(`${input}${os.EOL}`);
  });
}
