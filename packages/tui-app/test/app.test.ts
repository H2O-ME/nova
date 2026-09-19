/**
 * The surface end to end, without a terminal (M11 批4e).
 *
 * Every pure layer already has its own test; what this one protects is the
 * wiring none of them can see: a kernel event becoming the right rows, a key
 * becoming the right kernel call, the alternate screen being entered and left,
 * and the composer's text actually reaching the model. It runs the REAL
 * `createAgentKernel` over a scripted provider, the real `LineScreen` writing
 * into an in-memory terminal, and pushes keys through stdin — the closest thing
 * to `nova` this environment can run, since no TTY is available under the test
 * runner.
 */
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentMessage, ChatProvider, ChatRequest, StreamEvent } from '@nova-agent/core';
import { stringWidth } from '@nova-agent/tui';
import { createAgentKernel, type Kernel } from '@nova-agent/plugins';
import { TuiApp, type CommandOutcome, type CommandSpec } from '../src/index.js';

// ------------------------------------------------------------------ a terminal

/**
 * A terminal in memory: `LineScreen` writes cursor-addressed rows, and this
 * reconstructs the grid, so a test reads what a person would have seen.
 */
class FakeTerminal extends EventEmitter {
  columns = 100;
  rows = 24;
  /** Every byte written, for the enter/leave assertions. */
  readonly all: string[] = [];
  private grid: string[][] = [];
  private row = 0;
  private col = 0;

  write(text: string): boolean {
    this.all.push(text);
    this.feed(text);
    return true;
  }

  screen(): string {
    return this.grid.map((row) => plain(row).replace(/\s+$/, '')).join('\n');
  }

  private feed(text: string): void {
    let i = 0;
    while (i < text.length) {
      if (text[i] === '\x1b') {
        // eslint-disable-next-line no-control-regex -- the host's own protocol
        const seq = /^\x1b\[([0-9;?]*)([A-Za-z])/.exec(text.slice(i));
        if (seq === null) {
          i += 1;
          continue;
        }
        this.control(seq[1] ?? '', seq[2] ?? '');
        i += seq[0].length;
        continue;
      }
      this.put(text[i]!);
      i += 1;
    }
  }

  private control(params: string, final: string): void {
    if (final === 'H') {
      const [row, col] = params.split(';').map((part) => Number.parseInt(part, 10));
      this.row = Math.max(0, (row ?? 1) - 1);
      this.col = Math.max(0, (col ?? 1) - 1);
      return;
    }
    if (final === 'K') {
      const line = (this.grid[this.row] ??= []);
      line.length = Math.min(line.length, this.col);
      return;
    }
    // 1049 = the alternate screen; both directions start from a blank one.
    if ((final === 'h' || final === 'l') && params.startsWith('?')) this.grid = [];
  }

  private put(ch: string): void {
    const line = (this.grid[this.row] ??= []);
    while (line.length < this.col) line.push(' ');
    line[this.col] = ch;
    const width = stringWidth(ch);
    if (width === 2) line[this.col + 1] = '';
    this.col += Math.max(1, width);
  }
}

function plain(row: string[] | undefined): string {
  if (row === undefined) return '';
  let out = '';
  for (let i = 0; i < row.length; i++) out += row[i] ?? ' ';
  return out;
}

// ------------------------------------------------------------------ providers

function scriptedProvider(scripts: StreamEvent[][]): ChatProvider {
  let call = 0;
  return {
    async *stream(_req: ChatRequest) {
      const events = scripts[call] ?? [];
      call += 1;
      for (const event of events) yield event;
    },
  };
}

function delta(text: string): StreamEvent[] {
  return [
    { type: 'text_delta', text },
    { type: 'finish', finishReason: 'stop' },
  ];
}

function toolCall(name: string, args: Record<string, unknown>): StreamEvent[] {
  return [
    { type: 'tool_call_delta', index: 0, id: 'call_1', name, argsDelta: JSON.stringify(args) },
    { type: 'finish', finishReason: 'tool_calls' },
  ];
}

// -------------------------------------------------------------------- harness

interface HarnessOptions {
  commands?: readonly CommandSpec[];
  onCommand?: (text: string) => CommandOutcome;
  /** Tab: what the shell would switch to. */
  onCycleMode?: () => 'native' | 'ptc' | 'both' | undefined;
}

interface Harness {
  app: TuiApp;
  kernel: Kernel;
  terminal: FakeTerminal;
  workspace: string;
  started: Promise<void>;
  screen: () => string;
  send: (text: string) => void;
  close: () => Promise<void>;
}

async function open(scripts: StreamEvent[][], opts: HarnessOptions = {}): Promise<Harness> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'nova-tui-ws-'));
  const home = await mkdtemp(path.join(tmpdir(), 'nova-tui-home-'));
  // Sessions、缓存、技能一律挂在假 home 下：这个测试跑的是真内核，写盘要走真路径。
  const before = { home: process.env['HOME'], profile: process.env['USERPROFILE'] };
  process.env['HOME'] = home;
  process.env['USERPROFILE'] = home;

  const kernel = await createAgentKernel({
    rootDir: workspace,
    provider: scriptedProvider(scripts),
    config: { approval: 'read-only', bash: false },
  });
  const terminal = new FakeTerminal();
  const input = new EventEmitter() as unknown as NodeJS.ReadStream;
  const stream = input as unknown as { setRawMode?: (on: boolean) => void; resume?: () => void; pause?: () => void };
  stream.setRawMode = () => undefined;
  stream.resume = () => undefined;
  stream.pause = () => undefined;

  let clock = 1_000;
  const app = new TuiApp({
    agent: kernel.agent,
    tools: () => kernel.host.toolEntries.map((entry) => entry.tool),
    rootDir: workspace,
    homeDir: home,
    skills: 0,
    model: 'smoke-model',
    codeMode: kernel.codeMode(),
    commands: opts.commands ?? [],
    ...(opts.onCommand !== undefined ? { onCommand: opts.onCommand } : {}),
    ...(opts.onCycleMode !== undefined ? { onCycleMode: opts.onCycleMode } : {}),
    out: terminal as unknown as NodeJS.WriteStream,
    input,
    now: () => (clock += 10),
  });

  const started = app.start();
  await settle();

  return {
    app,
    kernel,
    terminal,
    workspace,
    started,
    screen: () => terminal.screen(),
    send: (text: string) => input.emit('data', Buffer.from(text, 'utf8')),
    close: async () => {
      await app.stop();
      await kernel.agent.dispose().catch(() => undefined);
      await kernel.jobs.dispose().catch(() => undefined);
      if (before.home === undefined) delete process.env['HOME'];
      else process.env['HOME'] = before.home;
      if (before.profile === undefined) delete process.env['USERPROFILE'];
      else process.env['USERPROFILE'] = before.profile;
    },
  };
}

/** Let every already-resolved promise chain run; the runs under test are all
 *  in-process (scripted provider, real fs). */
async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) await new Promise((resolve) => setImmediate(resolve));
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for a run to be over. A prompt is submitted asynchronously (the log
 * append comes first), so the first check can see an idle agent that has not
 * started yet — hence the settle before and after the poll.
 */
async function waitIdle(kernel: Kernel): Promise<void> {
  await wait(30);
  const deadline = Date.now() + 3_000;
  while (kernel.agent.running && Date.now() < deadline) await wait(5);
  await wait(30);
  await settle();
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await wait(5);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/**
 * Send a prompt and wait for its outcome to be ON SCREEN: dispatching a run is
 * asynchronous (the log append comes first), so a fixed sleep would be a coin
 * flip.
 */
async function submit(harness: Harness, text: string, expectOnScreen: string): Promise<void> {
  harness.send(text);
  harness.send('\r');
  await waitFor(() => harness!.screen().includes(expectOnScreen), `「${expectOnScreen}」on screen`);
  await settle();
}

/** Left-click the row containing `needle`, the way a terminal reports it. */
function clickRow(harness: Harness, needle: string): void {
  const rows = harness.screen().split('\n');
  const row = rows.findIndex((line) => line.includes(needle));
  if (row < 0) throw new Error(`no row on screen contains ${needle}\n${harness.screen()}`);
  harness.send(`\x1b[<0;6;${row + 1}M`);
}

/** The last tool result the model saw — what a denial turns into. */
function lastToolResult(kernel: Kernel): string {
  const messages: readonly AgentMessage[] = kernel.agent.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === 'tool') return message.content;
  }
  return '';
}

let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

// ---------------------------------------------------------------------- tests

describe('the TUI surface', () => {
  it('opens on the welcome card over an empty transcript', async () => {
    harness = await open([]);
    expect(harness.terminal.all.join('')).toContain('\x1b[?1049h'); // alternate screen
    const screen = harness.screen();
    expect(screen).toContain('工作区');
    expect(screen).toContain(harness.workspace);
    expect(screen).toContain('沙箱');
    // Keys live in the hint bar and nowhere else; the composer says only where
    // to type.
    expect(screen).toContain('描述任务…');
    expect(screen.trimEnd().split('\n').at(-1)).toContain('Enter');
  });

  it('renders a turn: the question, the tool row, then the answer', async () => {
    harness = await open([toolCall('read_file', { path: 'note.txt' }), delta('答案：42')]);
    await writeFile(path.join(harness.workspace, 'note.txt'), 'hello from disk\n');

    harness.send('你好');
    harness.send('\r');
    await waitIdle(harness.kernel);

    const screen = harness.screen();
    console.log('=== SCREEN ===' + JSON.stringify(screen));
    expect(screen).toContain('你好');
    // A lone read-only call is a verb-group row, not a row per call (grok's
    // verb_group): the file name is behind the fold.
    expect(screen).toContain('◈ 读取 1 个文件');
    expect(screen).toContain('答案：42');
  });

  it('opens a verb-group row on click, and closes it again', async () => {
    harness = await open([toolCall('read_file', { path: 'note.txt' }), delta('读完了')]);
    await writeFile(path.join(harness.workspace, 'note.txt'), 'hello from disk\n');
    await submit(harness, '看一下', '◈ 读取 1 个文件');
    await waitIdle(harness.kernel);

    expect(harness.screen()).toContain('◈ 读取 1 个文件');
    expect(harness.screen()).not.toContain('note.txt');

    clickRow(harness, '◈ 读取 1 个文件');
    await settle();
    // An explicit open beats the fold: the group dissolves into the member row.
    expect(harness.screen()).toContain('note.txt');
    expect(harness.screen()).not.toContain('◈ 读取 1 个文件');

    clickRow(harness, 'note.txt');
    await settle();
    expect(harness.screen()).toContain('◈ 读取 1 个文件'); // closed again
    expect(harness.screen()).not.toContain('note.txt');
  });

  it('blocks on an approval, and the keyboard answers it', async () => {
    harness = await open([toolCall('write_file', { path: 'out.txt', content: 'written' }), delta('写好了')]);

    harness.send('写一个文件');
    harness.send('\r');
    await waitFor(() => harness!.kernel.agent.pendingApprovals().length === 1, 'the approval request');
    await settle();

    let screen = harness.screen();
    expect(screen).toContain('需要审批');
    expect(screen).toContain('out.txt');

    harness.send('\r'); // the cursor starts on 「允许」
    await waitIdle(harness.kernel);

    expect(await readFile(path.join(harness.workspace, 'out.txt'), 'utf8')).toBe('written');
    screen = harness.screen();
    expect(screen).toContain('写好了');
    expect(screen).not.toContain('需要审批');
  });

  it('sends a typed denial reason back to the model as an instruction', async () => {
    harness = await open([toolCall('write_file', { path: 'no.txt', content: 'x' }), delta('好的')]);
    harness.send('写一个文件\r');
    await waitFor(() => harness!.kernel.agent.pendingApprovals().length === 1, 'the approval request');

    harness.send('\x1b[B'); // ↓ to 「总是允许」
    harness.send('\x1b[B'); // ↓ to 「拒绝」
    harness.send('换个路径');
    harness.send('\r');
    await waitIdle(harness.kernel);

    expect(lastToolResult(harness.kernel)).toContain('Permission denied: by user: 换个路径');
    expect(harness.screen()).toContain('好的');
  });
});

describe('keys that are not composer input', () => {
  it('opens the command palette on a slash draft and runs the choice', async () => {
    const sent: string[] = [];
    harness = await open([], {
      commands: [
        { name: '/help', usage: '/help', description: '命令清单' },
        { name: '/session', usage: '/session', description: '会话信息' },
      ],
      onCommand: (text) => {
        sent.push(text);
        return 'handled';
      },
    });

    harness.send('/');
    await settle();
    expect(harness.screen()).toContain('/help');
    expect(harness.screen()).toContain('/session');

    harness.send('s');
    await settle();
    expect(harness.screen()).toContain('/session');
    expect(harness.screen()).not.toContain('命令清单');

    harness.send('\r'); // Enter runs the row under the cursor
    await settle();
    expect(sent).toEqual(['/session']);
  });

  it('cycles the execution mode on Tab, and stops offering it once the turn starts', async () => {
    const cycles: string[] = [];
    harness = await open([delta('嗯')], {
      onCycleMode: () => {
        cycles.push('tab');
        return 'ptc';
      },
    });

    harness.send('\t');
    await settle();
    expect(cycles).toHaveLength(1);
    expect(harness.screen()).toContain('PTC'); // the status bar follows the switch

    harness.send('开始\r');
    await waitIdle(harness.kernel);
    harness.send('\t');
    await settle();
    expect(cycles).toHaveLength(1); // a turn has started: Tab is history navigation's
  });

  it('exits on the second Ctrl+C and leaves the alternate screen', async () => {
    harness = await open([]);
    harness.send('\x03');
    await settle();
    expect(harness.screen()).toContain('再按 Ctrl+C 退出');

    harness.send('\x03');
    await harness.started; // the shell's loop ends…
    await harness.close(); // …and the shell restores the terminal
    const written = harness.terminal.all.join('');
    expect(written).toContain('\x1b[?1049l');
    expect(written).toContain('\x1b[?25h'); // cursor visible again
  });
});