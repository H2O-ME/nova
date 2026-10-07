/**
 * The browser-facing controller (M11 批2): owns ONE kernel and fans its
 * `KernelEvent` stream out to the currently attached WebSocket, and turns
 * validated client frames into handle calls (`prompt`/`abort`/
 * `resolveApproval`/`compact`/session switch). It is a thin adapter — every
 * observable lives on the kernel stream, every mutation goes through the
 * AgentSession handle. It never touches HTTP or the WS handshake; those live
 * in `server.ts`.
 *
 * Reconnect contract: the durable log is the baseline. A client that (re)
 * attaches first gets `ready` (transcript projection + outstanding
 * approvals), then the live stream. A run continues across a dropped socket —
 * the next attach simply replays against the now-longer log.
 *
 * Inbound frames route in `frame-router.ts`; per-event render intent is
 * `wire-frame.ts`.
 */
import {
  isInsideNovaHome,
  SessionListing,
  sessionLogPath,
  sessionsRoot,
  sessionWorkspace,
  type AgentSession,
  type ConfiguredModel,
  type KernelEvent,
} from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import { ModelSeat } from './model-seat.js';
import { assembleReady } from './ready.js';
import { SessionPages } from './session-pages.js';
import { ContextFollow } from './context-follow.js';
import type { ClientFrame, ServerFrame } from './protocol.js';
import { ClientFanout } from './clients.js';
import { SessionFollow } from './session-follow.js';
import type { WsConnection } from './ws.js';
import type { ControllerOptions } from './options.js';
import type { ProviderHost } from './provider-frames.js';
import type { PickFn } from './picker-frames.js';
import { handleFrame } from './frame-router.js';
import { GitStatusCache } from './git-frames.js';
import { TermRegistry } from './term-session.js';
import { wireFrame } from './wire-frame.js';

export class WebController {
  private readonly kernel: Kernel;
  /** Who is attached, and how text reaches them (see clients.ts). */
  private readonly clients = new ClientFanout();
  /** Which session's event stream this controller is following (see session-follow.ts). */
  private readonly follow = new SessionFollow();
  /**
   * The model in force (label + context window) and the picker's server half.
   * Seeded from the shell (a kernel whose client cannot retarget still has to
   * name its model) and moved by the kernel's `model` event, so every client
   * renders the same answer.
   */
  private readonly seat: ModelSeat;
  /**
   * The sidebar's list. Held (not re-created per ask) because it memoizes the
   * head scans it has already paid for: re-asking after a switch costs a walk
   * and one stat per log, which is what makes "refresh silently on attach"
   * affordable at all.
   */
  private readonly sessions = new SessionListing(sessionsRoot());
  /** The two frozen windows a client pages back through (see `session-pages.ts`). */
  private readonly pages = new SessionPages();
  /**
   * The 终端 tab's live PTYs, one per session (see `term-session.ts`).
   *
   * Held here rather than per socket: the terminal belongs to the SESSION, so
   * two attached tabs watch the same one, and a switch must take the previous
   * session's process down (`retainOnly`).
   */
  private readonly terms = new TermRegistry();
  /**
   * The 变更 tab's status reading (see `git-frames.ts`).
   *
   * One per process so the tab, the file tree's decorations and a diff's
   * untracked check share a single scan — and so a mutation can evict it.
   */
  private readonly gitCache = new GitStatusCache();
  /** The Context panel's fold (see `context-follow.ts`); null-timeline when the plugin is off. */
  private readonly context = new ContextFollow();
  /**
   * Every session handle this controller has opened, keyed by its log file.
   *
   * One file, ONE writer: `Session.appendEvent` serializes writes through a
   * per-HANDLE chain, so two handles on the same log can each repair the tail and
   * append interleaved while their in-memory event streams drift apart. A switch
   * leaves the previous session RUNNING, so "switch away, then back" is exactly
   * how a second handle used to appear.
   */
  private readonly handles = new Map<string, AgentSession>();
  /**
   * Whether the `context` plugin was providing a reading at the last look.
   *
   * The one thing a settings flip must reach: turning the row on or off swaps
   * the provider, and the panel has to learn that from a frame. `ready` states
   * it at every attach, so this starts at the boot-time answer and only ever
   * fires on a CHANGE — a flip, not every frame.
   */
  private contextAvailable = false;

  private constructor(
    kernel: Kernel,
    seat: ModelSeat,
    private readonly version: string | undefined,
    /**
     * Remember a switch past this process (the shell's config file). Absent in
     * tests and in any surface with no durable home for the choice.
     */
    private readonly persistModel: ((model: string) => void | Promise<void>) | undefined,

    /** The operator's model list: its writer, and its on-demand reader. */
    private readonly persistModels: ((models: readonly ConfiguredModel[]) => void | Promise<void>) | undefined,
    /**
     * Not optional: with no durable home the answer is an EMPTY list, which the
     * page renders as "nothing configured yet" rather than the endpoint catalog.
     * Reporting a list nobody can save is the failure this avoids.
     */
    private readonly readModels: () => Promise<readonly ConfiguredModel[]>,
    /** The session-TITLE model's writer (`null` clears) and its on-demand reader. */
    private readonly persistTitleModel: ((model: string | null) => void | Promise<void>) | undefined,
    private readonly readTitleModel: () => Promise<string | null>,
    /**
     * The BYOK provider seams. Same shape as the model-list trio above and for
     * the same reason (only the shell knows the config file), plus the stored-key
     * lookup: a switch or a re-probe needs the secret, and the browser — which
     * never holds one — is what asked for the operation.
     */
    private readonly persistProviders: ProviderHost['persistProviders'],
    private readonly readProviders: ProviderHost['readProviders'],
    private readonly storedApiKey: ProviderHost['storedApiKey'],
    private readonly configuredModel: ProviderHost['configuredModel'],
    /**
     * The provider id the live client is currently serving. Mutable by design:
     * an applied switch moves it, and it must track the PROCESS, not the file —
     * the file can name an id the process never applied.
     */
    private liveProviderId: string | undefined,
    /** The native-dialog override for `pick_file` / `pick_directory` (tests). */
    private readonly pickPath: PickFn | undefined,
  ) {
    this.kernel = kernel;
    this.seat = seat;
  }

  static async create(opts: ControllerOptions): Promise<WebController> {
    // 装配由壳完成（`cli/kernel-boot.ts` 的 bootKernel）：controller 只消费内核。
    // 「未配置端点也要能起」由壳在装配时用占位 provider 表达（见 web-mode）；
    // 三个装配点由此收敛为一处，「新选项被静默丢掉」这类缝一并消失。
    const kernel = opts.kernel;
    const controller = new WebController(
      kernel,
      new ModelSeat(kernel.models, opts.providerModelLabel, opts.contextWindow, opts.providerModelName),
      opts.version,
      opts.persistModel,
      opts.persistModels,
      opts.readModels ?? (async () => []),
      opts.persistTitleModel,
      opts.readTitleModel ?? (async () => null),
      opts.persistProviders,
      opts.readProviders ?? (async () => ({ providers: [] })),
      opts.storedApiKey ?? (() => ({ problem: 'missing' as const })),
      opts.configuredModel ?? (() => undefined),
      opts.initialProviderId,
      opts.pickPath,
    );
    controller.adoptKernelSession();
    // The boot-time answer, so the first inbound frame does not look like a flip:
    // `ready` already stated it, and only a CHANGE is worth a frame.
    controller.contextAvailable = controller.context.available(kernel);
    return controller;
  }

  /**
   * The session THIS surface serves — pinned when followed, NOT a live read of
   * `kernel.agent` (the kernel's `current`). The kernel's current moves for
   * reasons that are not this surface's business: a QQ relay activating its
   * bound conversation per turn flips `current()`, and a live read here made
   * every webui client broadcast the QQ session's events — the two
   * conversations cross-contaminating each other's transcripts. The pin is
   * (re)taken only where the webui itself decides which session is open
   * (create / switch / replace / abandon), so a relay's activation never moves
   * what the browser is shown.
   */
  private pinnedAgent: AgentSession | undefined;

  get agent(): AgentSession {
    return this.pinnedAgent ?? this.kernel.agent;
  }

  /**
   * Tear down everything this controller owns, awaited and in order: sockets,
   * the followed session, every live session handle, the terminals, the jobs
   * registry, and the kernel itself.
   *
   * The kernel is OWNED here: the web surface assembled it (via the shell's
   * single boot point) and `launchWeb`'s close was the only teardown signal —
   * a dispose that stopped at clients+jobs left kernel fibers, session handles
   * and PTYs alive while the server socket shut under them. Every step is
   * individually guarded, so one failure cannot strand the rest, and a second
   * call is harmless.
   */
  async dispose(): Promise<void> {
    this.follow.stop();
    this.clients.close();
    this.terms.disposeAll();
    const handles = [...this.handles.values()];
    this.handles.clear();
    for (const handle of handles) {
      if (handle === this.agent) continue; // torn down with the kernel
      await handle.dispose().catch(() => undefined);
      await this.kernel.jobs.disposeSession(handle.session.id).catch(() => undefined);
    }
    await this.kernel.jobs.dispose().catch(() => undefined);
    await this.kernel.dispose().catch(() => undefined);
  }

  // ----------------------------------------------------------------- sockets

  /** Register a freshly-upgraded socket: send `ready`, start streaming. */
  attach(client: WsConnection): void {
    this.clients.attach(client, this.readyFrame());
  }

  /**
   * Forget a socket. When the LAST one goes, every human wait converges.
   *
   * The documented contract is fail-closed: an approval or a question nobody
   * can see must not hold its run open forever. A run itself keeps going —
   * a reconnect replays `ready` against the durable log and re-follows it —
   * but a card that died with its only viewer would otherwise park that run
   * until a reader happened to come back. Deny (never allow): a silence must
   * not become a grant.
   */
  detach(client: WsConnection): void {
    this.clients.detach(client);
    if (this.clients.count === 0) void this.convergeHumanWaits().catch(() => undefined);
  }

  /**
   * Deny every pending approval and cancel every pending question on every
   * live session handle — this controller's own current session included,
   * which never sits in the `handles` map. Re-checked before converging: a
   * client that re-attached while this was queued can see the cards again,
   * and they are then theirs to answer.
   */
  private async convergeHumanWaits(): Promise<void> {
    if (this.clients.count > 0) return;
    const sessions = new Set<AgentSession>(this.handles.values());
    try {
      sessions.add(this.agent);
    } catch {
      // The kernel already tore its sessions down (a dispose racing the last
      // detach): there is nothing left to converge.
    }
    for (const session of sessions) {
      for (const pending of session.pendingApprovals()) {
        session.resolveApproval(pending.id, {
          answer: 'deny',
          reason: '界面已断开：没有窗口能看到这次审批，按拒绝收敛（fail-closed）。',
        });
      }
      for (const question of session.pendingQuestions()) {
        session.cancelQuestion(question.id);
      }
    }
  }

  /** One validated inbound frame → zero or more kernel calls. Never throws. */
  async handle(client: WsConnection, frame: ClientFrame): Promise<void> {
    await handleFrame(client, frame, {
      agent: this.agent,
      kernel: this.kernel,
      seat: this.seat,
      sessions: this.sessions,
      pages: this.pages,
      terms: this.terms,
      gitCache: this.gitCache,
      context: this.context,
      persistModel: this.persistModel,
      persistModels: this.persistModels,
      // Every plugin operation goes through the kernel's own registry: the host
      // neither knows the plugin nor validates the operation, which is what keeps
      // a plugin's page out of this package. A plugin that is switched off has no
      // namespace registered, so it answers nothing — an answer, not an outage.
      pluginRpc: {
        invoke: (plugin, op, payload) => {
          const rpc = this.kernel.pluginRpc();
          if (rpc === undefined) {
            return Promise.reject(new Error('this assembly has no plugin registry'));
          }
          return rpc.invoke(plugin, op, payload);
        },
      },
      readModels: this.readModels,
      persistTitleModel: this.persistTitleModel,
      readTitleModel: this.readTitleModel,
      persistProviders: this.persistProviders,
      readProviders: this.readProviders,
      storedApiKey: this.storedApiKey,
      configuredModel: this.configuredModel,
      liveProviderId: () => this.liveProviderId,
      setLiveProviderId: (id) => { this.liveProviderId = id; },
      // The default tier lives on the KERNEL, not here: sessions are created by
      // several surfaces (the qqbot channel opens its own conversations), and a
      // default held in one controller would never reach the others.
      approvalDefault: () => this.kernel.approvalDefault,
      setApprovalDefault: (mode) => { this.kernel.setApprovalDefault(mode); },
      pickPath: this.pickPath,
      broadcast: (text) => { this.clients.broadcast(text); },
      readyFrame: () => this.readyFrame(),
      broadcastState: () => { this.broadcastState(); },
      switchSession: (opts) => this.switchSession(opts),
      abandonCurrentSession: () => this.abandonSession(),
      disposeLiveHandle: (file) => this.disposeLiveHandle(file),
      setWorkspace: (dir) => this.setWorkspace(dir),
    });
    // AFTER the frame: a workspace move replaces the session inside the kernel,
    // so follow it here rather than making every handler remember to.
    this.followSession();
    // …and a terminal belongs to the session that opened it, so the one just
    // left behind is taken down here — after EVERY frame, for the same reason
    // the context check below is: "which frame changed the session" rots.
    this.terms.retainOnly(this.agent.session.id);
    // …and after a plugin flip the provider may have appeared or gone, which is
    // the Context panel's whole on/off. Checked after EVERY frame (a map lookup)
    // because "which frame flipped it" is exactly the knowledge that rots.
    this.syncContextAvailability();
  }

  /** Tell every client when the context reading appeared or went away. */
  private syncContextAvailability(): void {
    const available = this.context.available(this.kernel);
    if (available === this.contextAvailable) return;
    this.contextAvailable = available;
    this.clients.broadcast(serialize(this.context.frame(this.agent, this.kernel)));
  }

  /**
   * Session-switch replies carry a fresh `ready` (new transcript baseline).
   *
   * Returning to a session that is STILL RUNNING is not a switch at all: the
   * live handle is activated, not rebuilt. Minting a second handle would put
   * two writers on one log (see `handles`), and disposing the live one to
   * re-resume it would cancel work the operator asked to keep running — its
   * pending approval or question would then be gone when they looked again.
   * Activating re-points the kernel's current session at the existing handle:
   * the run continues, and its cards are visible in the fresh baseline.
   */
  private async switchSession(opts: { resumeFile?: string }): Promise<void> {
    if (opts.resumeFile !== undefined) {
      // Resuming what is ALREADY open is not a switch: the client asked for a
      // baseline, and it already has the right one.
      if (opts.resumeFile === this.agent.session.file) {
        this.clients.broadcast(this.readyFrame());
        return;
      }
      const live = this.handles.get(opts.resumeFile);
      if (live !== undefined) {
        this.kernel.activateSession(live);
        this.adoptKernelSession();
        await this.followWorkspaceOf(this.agent);
        this.clients.broadcast(this.readyFrame());
        return;
      }
    }
    await this.replaceSession(opts);
    this.clients.broadcast(this.readyFrame());
  }

  /**
   * Delete the open session: dispose the handle, then start a fresh session.
   *
   * Deliberately NOT `switchSession`. A switch leaves the previous session
   * running (deliberate — see `followSession`), but this path deletes the log
   * that session appends to, so a survivor would write to a path that is gone
   * and `appendFile` would silently RECREATE it, leaving a log holding only the
   * post-delete events. Disposing first makes the removal final; the subscription
   * is then re-pointed at the replacement, and the client gets a new baseline.
   */
  private async abandonSession(): Promise<void> {
    const doomed = this.agent;
    // Order matters: unsubscribe BEFORE dispose, so the closing session's own
    // terminal events are not broadcast as if they belonged to the new one.
    this.follow.stop();
    this.handles.delete(doomed.session.file);
    await doomed.dispose().catch(() => undefined);
    // Jobs belong to the session that started them; a deleted session's running
    // work has nowhere to report, so it is cancelled rather than left orphaned.
    await this.kernel.jobs.disposeSession(doomed.session.id).catch(() => undefined);
    await this.replaceSession({});
    this.clients.broadcast(this.readyFrame());
  }

  /**
   * Tear down ANY live handle on a file — the `delete_session` frame's answer
   * to "this session is still running somewhere out of sight".
   *
   * Deleting a session that is not the open one used to be a bare unlink: the
   * switched-away handle survived, and its next append (a finishing run, a
   * queued prompt) called `appendFile` on the deleted path and RECREATED the
   * log as a truncated shell. Disposing first makes the removal final, the
   * same way `abandonSession` does for the open one. The path is resolved
   * through `sessionLogPath` — the same normalizer the delete validator uses —
   * so a differently-spelled alias of the same log cannot dodge the lookup.
   */
  async disposeLiveHandle(file: string): Promise<void> {
    let resolved: string;
    try {
      resolved = sessionLogPath(file);
    } catch {
      return; // not a legal session target; the delete itself will refuse it
    }
    const doomed = this.handles.get(resolved);
    if (doomed === undefined || doomed === this.agent) return;
    this.handles.delete(resolved);
    await doomed.dispose().catch(() => undefined);
    await this.kernel.jobs.disposeSession(doomed.session.id).catch(() => undefined);
  }

  /**
   * Point the kernel at a session (fresh, or resumed) and follow it.
   *
   * Shared by switch and abandon so both apply the same three rules — workspace,
   * approval default, subscription — instead of drifting apart.
   */
  private async replaceSession(opts: { resumeFile?: string }): Promise<void> {
    // A stale handle on the target file must go BEFORE the new one opens, or the
    // two would append to the same log through separate chains. (With the
    // activate path above this no longer fires on a plain switch — a live
    // handle is reused, never replaced — but `disposeLiveHandle` can leave a
    // handle here only by removing it, so this stays as belt-and-braces for
    // any future caller that passes a file whose handle is still open.)
    if (opts.resumeFile !== undefined) await this.disposeLiveHandle(opts.resumeFile);
    const agent =
      opts.resumeFile !== undefined
        ? await this.kernel.newAgentSession({ resumeFile: opts.resumeFile })
        : await this.kernel.newAgentSession();
    this.handles.set(agent.session.file, agent);
    // `newAgentSession` made this the kernel's current session, so this surface's
    // pin moves here NOW — before the workspace move below reads `this.agent`.
    this.adoptKernelSession();
    // Resuming re-points the tools at the workspace that session was created
    // in (the marker it logged) — a surface decision, so not the kernel's.
    await this.followWorkspaceOf(this.agent);
    // A tier settings picked earlier is the default for the sessions created
    // after it — applied before the baseline ships, so `ready` names the tier
    // that is actually in force. (The kernel cell feeds NEW sessions of every
    // surface; this only re-pins THIS handle, which may predate the pick.)
    const approvalDefault = this.kernel.approvalDefault;
    if (approvalDefault !== undefined && this.agent.approvalMode !== approvalDefault) {
      this.agent.setApprovalMode(approvalDefault);
    }
  }

  /**
   * Point the tools at the workspace the session records.
   *
   * A session switch has TWO paths — a still-live handle is activated, a cold one
   * is resumed — and the workspace rule belongs to the DECISION ("this session is
   * now open"), not to one of its implementations. Applying it only on the resume
   * path left "switch away, switch back" running the tools in the directory of
   * the session being left behind while the transcript showed this one.
   * @param agent - the session now open.
   */
  private async followWorkspaceOf(agent: AgentSession): Promise<void> {
    const workspace = sessionWorkspace(agent.session);
    if (workspace !== undefined && workspace !== this.kernel.rootDir() && !isInsideNovaHome(workspace)) {
      await this.setWorkspace(workspace).catch(() => undefined);
    }
  }

  /**
   * Follow the session this surface serves — the PIN, not `kernel.agent`.
   *
   * Idempotent, so a caller says "make sure I am following" rather than tracking
   * whether something replaced the session.
   *
   * Deliberately NOT a live read of the kernel's current: that moves for reasons
   * which are not this surface's business (a QQ relay activates its bound
   * conversation per turn), and re-reading it here made every later frame
   * re-point the browser at that other conversation — the transcript showed
   * somebody else's session and the next prompt landed in it. The pin moves only
   * through `adoptKernelSession`, called where the webui ITSELF decided which
   * session is open (see `agent` above).
   */
  private followSession(): void {
      this.follow.follow(this.agent, (event) => {
        if (event.type === 'model') {
          // The seat follows the session, then every client is re-stated with the
          // same `state` frame the mode switches use — it answers the same
          // question: "what is in force right now".
          this.seat.apply(event.model, { ...(event.name !== undefined ? { name: event.name } : {}), ...(event.contextWindow !== undefined ? { contextWindow: event.contextWindow } : {}) });
          this.broadcastState();
        }
        this.clients.broadcast(serialize(wireFrame(this.kernel, event)));
        // The context fold is measured at the REQUEST's end (a run's messages
        // and tool results are what the reading prices), and a run's end is a
        // request's end before it is anything else — so the freshest reading
        // rides the `run_stats` event rather than waiting for the panel to ask.
        if (event.type === 'run_stats') {
          this.clients.broadcast(serialize(this.context.frame(this.agent, this.kernel)));
        }
      });
  }

  /**
   * Adopt the kernel's current session as the one THIS surface serves, and
   * re-point the subscription at it.
   *
   * Called ONLY where the webui itself decided which session is open: boot, a
   * switch, a replace, and a workspace move (the kernel re-seeds a still-blank
   * session, which is a replacement this surface asked for). A frame arriving on
   * the socket is not such a place.
   */
  private adoptKernelSession(): void {
    this.pinnedAgent = this.kernel.agent;
    this.followSession();
  }

  /**
   * Move the workspace for the session THIS surface serves.
   *
   * `kernel.setWorkspace` acts on the kernel's current session, which another
   * surface may have moved (a QQ relay activates its bound conversation on every
   * inbound message). Pointing the kernel at this surface's session first keeps
   * the move — and the blank-session re-seed that rides it — on the conversation
   * the operator is looking at, instead of re-seeding somebody else's.
   *
   * The re-seed REPLACES a still-blank session (its context fragment is
   * append-only, see `runtime-workspace.ts`), so the pin follows the replacement.
   */
  private async setWorkspace(dir: string): Promise<void> {
    this.kernel.activateSession(this.agent);
    await this.kernel.setWorkspace(dir);
    this.adoptKernelSession();
  }

  /**
   * The owners `assembleReady` reads. Every path that changes what a client
   * must rebuild (attach, session switch, workspace move) ships a baseline, so
   * naming the set once keeps those paths from drifting apart.
   */
  private readyFrame(): string {
    return serialize({
      type: 'ready',
      info: assembleReady({
        agent: this.agent,
        kernel: this.kernel,
        seat: this.seat,
        pages: this.pages,
        ...(this.version !== undefined ? { version: this.version } : {}),
        context: this.context.reading(this.agent, this.kernel),
      }),
    });
  }

  private broadcastState(): void {
    this.clients.broadcast(serialize({
      type: 'state',
      approvalMode: this.agent.approvalMode ?? 'read-only',
      model: this.seat.model,
      // Only when there IS a catalog name: the field means "metadata exists",
      // so a reader can fall back to the id without re-deriving the rule.
      ...(this.seat.name !== this.seat.model ? { modelName: this.seat.name } : {}),
    }));
  }

}

function serialize(frame: ServerFrame): string {
  return JSON.stringify(frame);
}

/** Re-export for the server's event fanout typing (keeps KernelEvent local). */
export type { KernelEvent };
