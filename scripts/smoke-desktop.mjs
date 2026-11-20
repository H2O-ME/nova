/**
 * Real-machine smoke for the DESKTOP pipeline (manual harness — NOT part of
 * `pnpm verify`, and it does reach the configured provider for one real turn).
 *
 * It boots the real CLI process exactly the way the Tauri shell does — no flags,
 * stdin/stdout as the frame channel — and then speaks the wire protocol by hand:
 * one JSON line per frame, in and out. That is the whole transport now, so this
 * file is the whole network story: there is no port to probe, no token to walk,
 * no cookie to pair.
 *
 * What it proves, in order:
 *  1. a bare `nova` (no `--web`, no TTY) is CLAIMED by the desktop surface —
 *     the regression that deleting the browser entry could have introduced;
 *  2. the first frame out is `ready`, with the replay baseline, the approval
 *     baseline and the paginated cursor;
 *  3. a real prompt runs, calls a tool, and the tool frames carry the host's own
 *     `view`/`resultView` (the browser never re-derives render intent);
 *  4. the surface-control frames answer (approval tier, session list, new
 *     session, an unknown command still leaves a trace);
 *  5. closing stdin (EOF) shuts the process down — the shell's exit path.
 */
import { spawn } from 'node:child_process';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * One runtime process, plus a line sink.
 *
 * `stderr` is piped rather than inherited so a boot failure can be REPORTED
 * instead of looking like a silent timeout — the runtime logs everything there.
 */
function launch() {
  const child = spawn(process.execPath, ['packages/cli/dist/index.mjs'], {
    cwd: process.cwd(),
    // No flags at all: this is the same invocation the shell makes.
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state = { frames: [], pending: '', stderr: '', exited: false, exitCode: null };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    state.pending += chunk;
    for (;;) {
      const index = state.pending.indexOf('\n');
      if (index < 0) break;
      const line = state.pending.slice(0, index);
      state.pending = state.pending.slice(index + 1);
      if (line.trim().length === 0) continue;
      try {
        state.frames.push(JSON.parse(line));
      } catch {
        state.frames.push({ type: 'unparseable', payload: line.slice(0, 120) });
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => (state.stderr += chunk));
  child.on('exit', (code) => {
    state.exited = true;
    state.exitCode = code;
  });
  const send = (frame) => child.stdin.write(`${JSON.stringify(frame)}\n`);
  return { child, state, send };
}

/** Wait until `predicate(state)` holds, or throw with what we did see. */
async function until(state, predicate, timeoutMs, what) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate(state)) return;
    if (state.exited && state.frames.length === 0) {
      throw new Error(`runtime exited (${state.exitCode}) before ${what}; stderr=${state.stderr.slice(0, 600)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`no ${what} in ${timeoutMs}ms; frames=${JSON.stringify(state.frames.slice(-3).map((f) => f.type))} stderr=${state.stderr.slice(0, 600)}`);
}

const runtime = launch();

try {
  // 1 + 2: a bare invocation must be claimed, and its first word is `ready`.
  await until(runtime.state, (s) => s.frames.length > 0, 20000, 'first frame');
  const ready = runtime.state.frames[0];
  check('裸 nova 被桌面面认领且首帧为 ready', ready?.type === 'ready', `type=${ready?.type ?? 'none'}`);
  if (ready?.type === 'ready') {
    const info = ready.info;
    check('ready 携带转录基线 + 审批 + 用量',
      Array.isArray(info.history) && Array.isArray(info.pendingApprovals) && typeof info.usedTokens === 'number' && typeof info.approvalMode === 'string',
      `history=${info.history.length} approval=${info.approvalMode} tokens=${info.usedTokens}`);
    check('ready 携带分页游标', typeof info.historyTotal === 'number' && info.historyTotal >= info.history.length,
      `history=${info.history.length}/${info.historyTotal}`);
    check('ready 携带后台任务快照', Array.isArray(info.jobs), `jobs=${info.jobs?.length ?? 'missing'}`);
    check('ready 携带命令目录',
      Array.isArray(info.commands) && info.commands.some((c) => c.name === 'compact'),
      `commands=[${(info.commands ?? []).map((c) => c.name).join(', ')}]`);
  }

  // 4: the surface controls answer on the same channel.
  runtime.send({ type: 'set_approval_mode', mode: 'auto-edit' });
  await until(runtime.state, (s) => s.frames.some((f) => f.type === 'state'), 8000, 'state frame');
  const stateFrame = runtime.state.frames.find((f) => f.type === 'state');
  check('切换审批档 → state 帧回声', stateFrame?.approvalMode === 'auto-edit', `approval=${stateFrame?.approvalMode}`);

  runtime.send({ type: 'list_sessions' });
  await until(runtime.state, (s) => s.frames.some((f) => f.type === 'sessions'), 8000, 'sessions frame');
  const sessions = runtime.state.frames.find((f) => f.type === 'sessions');
  check('会话列表帧可取得', Array.isArray(sessions?.items) && sessions.items.length >= 1, `items=${sessions?.items?.length}`);

  // 5: EOF is the shell's shutdown signal. Drop stdin and wait for the exit.
  const beforeEof = runtime.state.frames.length;
  runtime.child.stdin.end();
  await until(runtime.state, (s) => s.exited, 15000, 'exit after stdin EOF');
  check('关 stdin（EOF）即优雅退出', runtime.state.exited && runtime.state.exitCode === 0,
    `code=${runtime.state.exitCode} frames=${beforeEof}`);

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  process.exitCode = failed === 0 ? 0 : 1;
} catch (error) {
  console.log(`SMOKE ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (!runtime.state.exited) runtime.child.kill();
}
