/**
 * The TUI surface (M11 批4d): a thin driver over the pure layers.
 *
 * It owns exactly four things a pure function cannot: the alternate screen,
 * the raw keyboard, one clock, and the kernel subscription. Everything the
 * screen *looks* like is computed by `entries` / `panels` / `frame`, and every
 * key is decided by `keys` — so this file has no layout arithmetic and no
 * opinions about copy, which is the whole reason the last TUI could not be
 * tested without a terminal.
 *
 * The clock is singular (`TICK_MS`): the spinner, the rail's travelling wave
 * and the typewriter cursor are all derived from one counter, because two
 * near-frequency clocks beat visibly against each other.
 */
import {
  KeyDecoder,
  LineScreen,
  detectCaps,
  type Key,
  type TerminalCaps,
} from '@nova-agent/tui';
import { errMessage, type AgentSession, type KernelEvent, type PtcMode, type ToolViewSource } from '@nova-agent/core';
import { initialTranscript, reduce, type TranscriptState } from './blocks.js';
import { buildEntries } from './entries.js';
import { buildFrame, type Frame } from './frame.js';
import { createUiState, handleKey, type CommandSpec, type PanelRow, type TuiAction, type UiState } from './keys.js';
import { TICK_MS } from './layout.js';
import {
  approvalCard,
  approvalScopeOf,
  composerCard,
  hintBar,
  listPanel,
  queueLane,
  welcomeCard,
  type KeyboardOwner,
} from './panels.js';
import { paintBlock } from './render.js';
import { Scrollback, type ScrollEntry } from './scrollback.js';
import { statusLine } from './status-bar.js';
import { buildPalette, plainPalette, type Palette } from './theme.js';
import { turnStatusLine } from './turn-status.js';

/** What a slash input's handler did — see `submit()`. */
export type CommandOutcome = 'handled' | string | undefined;

export interface TuiAppOptions {
  agent: AgentSession;
  /** Live tool registry: presentation views resolve from the same source everywhere. */
  tools: () => readonly ToolViewSource[];
  rootDir: string;
  homeDir: string;
  skills: number;
  model: string;
  codeMode: PtcMode;
  commands?: readonly CommandSpec[];
  contextWindow?: number | undefined;
  autoCompactTokenLimit?: number | undefined;
  /** Slash input + skill invocation. `'handled'` = consumed, a string = prompt it. */
  onCommand?: (text: string) => Promise<CommandOutcome> | CommandOutcome;
  /** Tab: cycle the execution mode; undefined = not available now. */
  onCycleMode?: () => PtcMode | undefined;
  out?: NodeJS.WriteStream & { write(s: string): unknown };
  input?: NodeJS.ReadStream;
  palette?: Palette;
  caps?: TerminalCaps;
  now?: () => number;
}

/** Rows of the transcript kept for the animation cache key. */
const TPS_BUCKET_MS = 500;
const TPS_BUCKETS = 10;

export class TuiApp {
  private readonly opts: TuiAppOptions;
  private agent: AgentSession;
  private readonly out: NodeJS.WriteStream & { write(s: string): unknown };
  private readonly input: NodeJS.ReadStream;
  private readonly now: () => number;
  private readonly screen: LineScreen;
  private readonly decoder = new KeyDecoder();
  private readonly scrollback = new Scrollback();

  private palette: Palette;
  private caps: TerminalCaps;
  private state: UiState = createUiState();
  private transcript: TranscriptState = initialTranscript;
  private version = 0;
  private entries: ScrollEntry[] = [];
  private entriesKey = '';
  private frame: Frame | undefined;
  private tick = 0;
  private timer: NodeJS.Timeout | undefined;
  private escTimer: NodeJS.Timeout | undefined;
  private unsubscribe: (() => void) | undefined;
  private panelSelect: ((index: number) => void) | undefined;
  private noteSeq = 0;
  private exiting = false;
  private started = false;
  private finish: (() => void) | undefined;
  private model: string;
  private codeMode: PtcMode;
  private contextWindow: number | undefined;
  private limit: number | undefined;
  private cacheRate: number | null = null;
  private tps: number[] = [];
  private tpsAt = 0;
  private tpsIndex = 0;
  private lastTps = 0;

  constructor(opts: TuiAppOptions) {
    this.opts = opts;
    this.agent = opts.agent;
    this.out = opts.out ?? process.stdout;
    this.input = opts.input ?? process.stdin;
    this.now = opts.now ?? Date.now;
    this.caps = opts.caps ?? detectCaps();
    this.palette = opts.palette ?? (this.caps.color ? buildPalette(this.caps) : plainPalette());
    this.screen = new LineScreen(this.out, { synchronizedOutput: this.caps.synchronizedOutput });
    this.model = opts.model;
    this.codeMode = opts.codeMode;
    this.contextWindow = opts.contextWindow;
    this.limit = opts.autoCompactTokenLimit;
    this.tps = Array.from({ length: TPS_BUCKETS }, (): number => 0);
  }

  /** Enter the alternate screen and run until the user exits. */
  async start(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.finish = resolve;
      this.started = true;
      this.screen.enter();
      this.input.setRawMode?.(true);
      this.input.resume();
      this.input.on('data', this.onData);
      this.out.on('resize', this.onResize);
      this.unsubscribe = this.agent.subscribe(this.onEvent);
      for (const request of this.agent.pendingApprovals()) this.onEvent({ type: 'approval_request', request });
      this.timer = setInterval(() => this.onTick(), TICK_MS);
      this.render();
    });
  }

  /** Restore the terminal. Safe to call twice; never throws. */
  async stop(): Promise<void> {
    this.started = false;
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.escTimer !== undefined) clearTimeout(this.escTimer);
    this.timer = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.input.off('data', this.onData);
    this.out.off('resize', this.onResize);
    this.input.setRawMode?.(false);
    this.input.pause();
    this.screen.exit();
  }

  /** Leave the alternate screen (used by `/exit`). */
  requestExit(): void {
    void this.exit();
  }

  /**
   * Follow another session handle (`/new`, session switch): the durable log is
   * the truth, so the surface drops its view and replays the new one's.
   */
  setAgent(agent: AgentSession): void {
    this.unsubscribe?.();
    this.agent = agent;
    this.transcript = initialTranscript;
    this.version += 1;
    this.scrollback.scrollToBottom();
    this.entriesKey = '';
    for (const request of agent.pendingApprovals()) this.onEvent({ type: 'approval_request', request });
    this.unsubscribe = this.started ? agent.subscribe(this.onEvent) : undefined;
    this.render();
  }

  // ----------------------------------------------------------- kernel driving

  private readonly onEvent = (event: KernelEvent): void => {
    if (event.type === 'approval_request') {
      this.state = { ...this.state, approval: { cursor: 0, denyReason: '', scopeWords: 1 }, transient: undefined };
    }
    if (event.type === 'text_delta' || event.type === 'reasoning_delta') this.countOutput(event.text);
    this.transcript = reduce(this.transcript, event, { tools: this.opts.tools, now: this.now() });
    this.version += 1;
    if (event.type === 'usage' || event.type === 'done') this.refreshUsage();
    this.render();
  };

  private readonly onData = (chunk: Buffer): void => {
    for (const key of this.decoder.push(chunk)) this.onKey(key);
    if (this.decoder.hasPendingEsc()) {
      // A lone ESC is either the Esc key or the head of a sequence split across
      // reads; give the rest of the sequence a chance to arrive first.
      if (this.escTimer !== undefined) clearTimeout(this.escTimer);
      this.escTimer = setTimeout(() => {
        const esc = this.decoder.flushPendingEsc();
        if (esc !== undefined) this.onKey(esc);
      }, 25);
    }
  };

  private readonly onResize = (): void => {
    this.screen.invalidate();
    this.entriesKey = '';
    this.render();
  };

  private onTick(): void {
    this.tick += 1;
    this.rotateTps();
    if (this.animating()) this.render();
  }

  // --------------------------------------------------------------------- keys

  private onKey(key: Key): void {
    if (key.type === 'focusin') {
      this.screen.reassertModes();
      return;
    }
    const pending = this.transcript.pending ?? undefined;
    const { state, action } = handleKey(this.state, key, {
      running: this.agent.running,
      pending,
      commands: this.opts.commands ?? [],
      canSwitchMode: this.opts.onCycleMode !== undefined && !this.agent.running && this.transcript.turnCount === 0,
      entryAt: (row) => this.entryIdAt(row),
    });
    this.state = state;
    void this.apply(action);
  }

  private async apply(action: TuiAction): Promise<void> {
    switch (action.kind) {
      case 'exit':
        await this.exit();
        return;
      case 'abort':
        this.agent.abort();
        return;
      case 'cycleMode': {
        const next = this.opts.onCycleMode?.();
        if (next !== undefined) this.codeMode = next;
        else this.note('当前无法切换执行模式');
        this.render();
        return;
      }
      case 'resolve':
        this.agent.resolveApproval(action.id, action.answer);
        return;
      case 'scroll':
        this.scrollback.scrollBy(action.delta, this.transcriptRows());
        this.render();
        return;
      case 'toggle':
        this.toggleEntry(action.entryId);
        return;
      case 'panelSelect': {
        // The command palette's Enter runs the command under the cursor; a
        // modal panel hands the index back to whoever opened it.
        const panel = this.state.panel;
        this.state = { ...this.state, panel: undefined };
        if (panel?.kind === 'commands') {
          const usage = panel.rows[action.index]?.label;
          if (usage !== undefined) await this.submit(usage);
          return;
        }
        this.panelSelect?.(action.index);
        return;
      }
      case 'panelClose':
        // `-1` = dismissed without a choice, so a caller awaiting a pick can
        // settle instead of hanging on a promise nobody will resolve.
        this.panelSelect?.(-1);
        this.panelSelect = undefined;
        return;
      case 'submit':
        await this.submit(action.text);
        return;
      default:
        this.render();
    }
  }

  private async submit(text: string): Promise<void> {
    let prompt = text;
    if (text.startsWith('/')) {
      const outcome = this.opts.onCommand === undefined ? undefined : await this.opts.onCommand(text);
      if (outcome === 'handled') {
        this.render();
        return;
      }
      if (outcome === undefined) {
        if (this.opts.onCommand !== undefined) {
          // A handler that does not know the command has already said so.
          this.render();
          return;
        }
        this.note(`未知命令：${text.split(/\s+/)[0] ?? text}`);
        this.render();
        return;
      }
      prompt = outcome;
    }
    this.scrollback.scrollToBottom();
    try {
      await this.agent.prompt(prompt);
    } catch (err) {
      this.note(`出错：${errMessage(err)}`, 'warn');
    }
    this.render();
  }

  private async exit(): Promise<void> {
    if (this.exiting) return;
    this.exiting = true;
    this.finish?.();
  }

  /**
   * Toggle a row's fold. A tool row's entry id *is* its block id; a verb-group
   * header (`group:0,1,2`, the collapsed read-only run) carries its members'
   * indices, and opening it is what makes its `▸` real — the row claims to be
   * clickable, so clicking it must do something.
   */
  private toggleEntry(entryId: string): void {
    const members = entryId.startsWith('group:')
      ? new Set(entryId.slice('group:'.length).split(',').map((part) => Number.parseInt(part, 10)))
      : undefined;
    let changed = false;
    const blocks = this.transcript.blocks.map((block, index) => {
      const hit = members === undefined ? block.id === entryId : members.has(index);
      if (!hit || block.kind !== 'tool') return block;
      changed = true;
      return { ...block, expanded: !block.expanded };
    });
    if (!changed) return;
    this.transcript = { ...this.transcript, blocks };
    this.version += 1;
    this.render();
  }

  private entryIdAt(row: number): string | undefined {
    const owners = this.frame?.owners ?? [];
    const index = owners[row];
    if (index === undefined || index < 0) return undefined;
    return this.entries[index]?.id;
  }

  // ------------------------------------------------------------------- surface

  /** A line in the transcript from the surface itself (command output). */
  note(text: string, tone: 'info' | 'warn' = 'info'): void {
    const blocks = text
      .split('\n')
      .map((line) => ({ id: `n${(this.noteSeq += 1)}`, kind: 'hint' as const, text: line, tone }));
    this.transcript = { ...this.transcript, blocks: [...this.transcript.blocks, ...blocks] };
    this.version += 1;
  }

  /** A modal list (model/session pickers); the caller owns the selection.
   *  `onSelect(-1)` means the panel was dismissed without a choice. */
  openPanel(opts: { title: string; rows: readonly PanelRow[]; onSelect: (index: number) => void }): void {
    this.panelSelect = opts.onSelect;
    this.state = { ...this.state, panel: { kind: 'modal', title: opts.title, rows: opts.rows, cursor: 0 } };
    this.render();
  }

  setModel(model: string): void {
    this.model = model;
    this.render();
  }

  setCodeMode(mode: PtcMode): void {
    this.codeMode = mode;
    this.render();
  }

  setContextWindow(contextWindow: number | undefined): void {
    this.contextWindow = contextWindow;
    this.render();
  }

  setPalette(palette: Palette, caps?: TerminalCaps): void {
    this.palette = palette;
    if (caps !== undefined) this.caps = caps;
    this.screen.invalidate();
    this.entriesKey = '';
    this.render();
  }

  /** Drop the transcript (the log keeps everything — this is the screen only). */
  clear(): void {
    this.transcript = initialTranscript;
    this.version += 1;
    this.scrollback.scrollToBottom();
    this.render();
  }

  // ------------------------------------------------------------------ rendering

  private animating(): boolean {
    if (this.agent.running) return true;
    return this.transcript.blocks.some(
      (block) =>
        (block.kind === 'text' && block.streaming) ||
        (block.kind === 'reasoning' && block.streaming) ||
        (block.kind === 'tool' && block.result === undefined) ||
        (block.kind === 'hint' && block.tone === 'live'),
    );
  }

  private transcriptRows(): number {
    return this.frame?.viewport.screen.length ?? 5;
  }

  private render(): void {
    if (!this.started) return; // nothing is written before the alternate screen
    const cols = this.screen.cols;
    const rows = this.screen.rows;
    const idle = !this.agent.running;
    const key = `${cols}|${this.version}|${this.codeMode}|${idle ? 'idle' : this.tick}`;
    if (key !== this.entriesKey) {
      const built = buildEntries({
        blocks: this.transcript.blocks,
        cols,
        palette: this.palette,
        paintBlock,
        opts: { tick: this.tick, idle },
      });
      this.entries = [...this.welcomeEntry(cols), ...built];
      this.scrollback.setEntries(this.entries);
      this.entriesKey = key;
    }

    const pending = this.transcript.pending;
    const composer = composerCard({ cols, composer: this.state.composer, palette: this.palette });
    const frame = buildFrame({
      cols,
      rows,
      scrollback: this.scrollback,
      turn: this.turnLine(cols),
      popup: this.panelLines(cols),
      queue: queueLane({ cols, items: this.transcript.queued, palette: this.palette }),
      composer,
      status: this.statusLine(cols),
      hints: this.hintLine(cols, pending !== null),
    });
    this.frame = frame;
    this.screen.render(frame.lines, frame.cursor);
  }

  /** The opening card exists only while the transcript is empty. */
  private welcomeEntry(cols: number): ScrollEntry[] {
    if (this.transcript.blocks.length > 0) return [];
    const lines = welcomeCard({
      cols,
      rootDir: this.opts.rootDir,
      sessionsDir: foldHome(this.agent.session.file, this.opts.homeDir),
      skills: this.opts.skills,
      mode: this.codeMode,
      palette: this.palette,
    });
    return [{ id: 'welcome', lines, dense: false, center: true }];
  }

  private turnLine(cols: number): string {
    const startedAt = this.transcript.turnStartedAt;
    if (startedAt === undefined) return '';
    const phase = this.transcript.phase === 'disconnected' ? 'idle' : this.transcript.phase;
    return turnStatusLine(
      {
        cols,
        tick: this.tick,
        phase,
        startedAt,
        now: this.now(),
        queued: this.transcript.queued.length,
        promptTokens: this.agent.lastPromptTokens,
        blockedOnUser: this.transcript.pending !== null,
      },
      this.palette,
    );
  }

  private statusLine(cols: number): string {
    const compactRatio =
      this.limit === undefined || this.limit <= 0 ? undefined : Math.min(1, this.agent.lastPromptTokens / this.limit);
    return statusLine(
      {
        cols,
        usedTokens: this.agent.lastPromptTokens,
        contextWindow: this.contextWindow ?? null,
        model: this.model,
        codeMode: this.codeMode,
        approvalMode: this.agent.approvalMode ?? 'read-only',
        tps: this.currentTps(),
        cacheHitRate: this.cacheRate,
        compactRatio: compactRatio ?? null,
        ...(this.state.transient !== undefined ? { transient: this.state.transient } : {}),
      },
      this.palette,
    ).line;
  }

  private hintLine(cols: number, blocked: boolean): string {
    const owner: KeyboardOwner = blocked ? 'approval' : this.state.panel !== undefined ? 'panel' : this.agent.running ? 'running' : 'composer';
    const pending = this.transcript.pending;
    const scope = pending === undefined || pending === null ? undefined : approvalScopeOf(pending, this.state.approval.scopeWords);
    const onAlways = this.state.approval.cursor === 1;
    const onDeny = this.state.approval.cursor === 2;
    return hintBar(
      {
        cols,
        owner,
        palette: this.palette,
        canSwitchMode: this.opts.onCycleMode !== undefined && !this.agent.running && this.transcript.turnCount === 0,
        approvalScope: onAlways && scope !== undefined,
        denyTyping: onDeny,
      },
      this.palette,
    );
  }

  private panelLines(cols: number): string[] {
    const pending = this.transcript.pending;
    if (pending !== null) {
      return approvalCard({
        cols,
        request: pending,
        cursor: this.state.approval.cursor,
        scope: approvalScopeOf(pending, this.state.approval.scopeWords),
        denyReason: this.state.approval.denyReason,
        palette: this.palette,
      });
    }
    const panel = this.state.panel;
    if (panel === undefined) return [];
    const budget = Math.max(3, Math.floor(this.screen.rows / 2) - 2);
    const maxRows = Math.max(1, budget - 2);
    const offset = Math.max(0, Math.min(panel.cursor - maxRows + 1, Math.max(0, panel.rows.length - maxRows)));
    return listPanel({
      cols,
      title: panel.title,
      rows: panel.rows,
      cursor: panel.cursor,
      offset,
      maxRows,
      palette: this.palette,
    });
  }

  // ------------------------------------------------------------------- metrics

  private countOutput(text: string): void {
    this.tps[this.tpsIndex] = (this.tps[this.tpsIndex] ?? 0) + text.length / 4;
  }

  private rotateTps(): void {
    const now = this.now();
    if (this.tpsAt === 0) {
      this.tpsAt = now;
      return;
    }
    let advanced = false;
    while (now - this.tpsAt >= TPS_BUCKET_MS) {
      this.tpsAt += TPS_BUCKET_MS;
      this.tpsIndex = (this.tpsIndex + 1) % TPS_BUCKETS;
      this.tps[this.tpsIndex] = 0;
      advanced = true;
    }
    if (advanced) {
      const perSecond = this.tps.reduce((sum, value) => sum + value, 0) / ((TPS_BUCKETS * TPS_BUCKET_MS) / 1000);
      // Session-level and sticky-low: the window ages out on its own, but a
      // turn that is thinking (or running a tool) keeps reporting the last
      // measured speed instead of snapping to zero.
      if (perSecond > 0) this.lastTps = perSecond;
      else if (!this.agent.running) this.lastTps = 0;
    }
  }

  private currentTps(): number | null {
    const perSecond = this.tps.reduce((sum, value) => sum + value, 0) / ((TPS_BUCKETS * TPS_BUCKET_MS) / 1000);
    const value = perSecond > 0 ? perSecond : this.agent.running ? this.lastTps : 0;
    return value > 0 ? value : null;
  }

  private refreshUsage(): void {
    const stats = this.agent.usageSnapshot();
    if (stats.promptTokens <= 0) return;
    // Sticky: a gateway that routes some requests to a backend which does not
    // report cache hits would otherwise blink the field in and out mid-session.
    this.cacheRate = Math.min(1, Math.max(0, stats.cachedTokens / stats.promptTokens));
  }
}

/** `C:\Users\x\.nova\sessions\…` → `~/.nova/sessions/…`, so the tail survives. */
function foldHome(file: string, home: string): string {
  if (home.length === 0 || !file.startsWith(home)) return file;
  return `~${file.slice(home.length).replace(/\\/g, '/')}`;
}
