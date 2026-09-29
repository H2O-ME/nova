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
  sessionsRoot,
  sessionWorkspace,
  unconfiguredProvider,
  type AgentSession,
  type ApprovalMode,
  type ConfiguredModel,
  type KernelEvent,
} from '@nova-agent/core';
import { createAgentKernel, type Kernel } from '@nova-agent/plugins';
import { ModelSeat } from './model-seat.js';
import { assembleReady } from './ready.js';
import { SessionPages } from './session-pages.js';
import type { ClientFrame, ServerFrame } from './protocol.js';
import { ClientFanout } from './clients.js';
import { SessionFollow } from './session-follow.js';
import type { WsConnection } from './ws.js';
import type { ControllerOptions } from './options.js';
import type { ProviderHost } from './provider-frames.js';
import { handleFrame } from './frame-router.js';
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
   * The approval tier settings picked, applied to every session created after
   * it. The config file stays the boot default (the server does not rewrite
   * it); within this process the settings row's promise — 新会话的默认权限模式 —
   * is kept here, at the one place that creates sessions.
   */
  private approvalDefault: ApprovalMode | undefined;

  private constructor(
    kernel: Kernel,
    seat: ModelSeat,
    private readonly version: string | undefined,
    /**
     * Remember a switch past this process (the shell's config file). Absent in
     * tests and in any surface with no durable home for the choice.
     */
    private readonly persistModel: ((model: string) => void | Promise<void>) | undefined,
    /**
     * The qqbot page's config writer + snapshot + probe. The snapshot travels
     * OUT on every `qqbot` ask (never the secret); the writer runs on save; the
     * probe runs on test. Injected by the shell for the same reason as
     * `persistModel` — only the shell knows the config file.
     */
    private readonly persistQqBot: ((opts: { appId?: string; clientSecret?: string }) => void | Promise<void>) | undefined,
    /**
     * The qqbot connection snapshot the page reads. NOT readonly: a save is
     * echoed back by replacing it, so the page's next open reflects what was
     * just stored rather than the boot-time value (the host never returns the
     * secret, so re-reading the file would not be equivalent).
     */
    private qqBotSnapshot: ControllerOptions['qqBotConfig'],
    private readonly testQqBot: ((opts: { appId: string; clientSecret: string }) => Promise<string>) | undefined,
    /**
     * Re-derive the qqbot problem from disk after a save (see `ManageHost`).
     * Absent with no durable home, like the other config writers.
     */
    private readonly recheckQqBot: (() => Promise<string | undefined>) | undefined,
    /**
     * The live QQ channel this process runs, when it runs one.
     *
     * A different question from `recheckQqBot` above: that one reads the FILE,
     * this one reports whether the gateway is actually up and what a save does
     * about it. Storing credentials is not connecting them, and the channel was
     * built at boot when the file was still empty — so without this seam a save
     * would keep writing the config and nothing would dial out.
     */
    private readonly qqBotRuntime: ControllerOptions['qqBotRuntime'],
    /** The operator's model list: its writer, and its on-demand reader. */
    private readonly persistModels: ((models: readonly ConfiguredModel[]) => void | Promise<void>) | undefined,
    /**
     * Not optional: with no durable home the answer is an EMPTY list, which the
     * page renders as "nothing configured yet" rather than the endpoint catalog.
     * Reporting a list nobody can save is the failure this avoids.
     */
    private readonly readModels: () => Promise<readonly ConfiguredModel[]>,
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
  ) {
    this.kernel = kernel;
    this.seat = seat;
  }

  static async create(opts: ControllerOptions): Promise<WebController> {
    const kernel = await createAgentKernel({
      rootDir: opts.rootDir,
      // Absent means "no endpoint configured yet": the kernel still assembles
      // (it needs a provider to type its `llm` service), so the shell passes a
      // refusing placeholder rather than making the whole surface conditional on
      // a config the operator has not written. See `ControllerOptions.provider`.
      provider: opts.provider ?? unconfiguredProvider(),
      config: opts.config,
      ...(opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : {}),
      ...(opts.modelCatalog !== undefined ? { modelCatalog: opts.modelCatalog } : {}),
      ...(opts.surfaces !== undefined ? { surfaces: opts.surfaces } : {}),
      // The browser is a surface WITH a human: `ask_user_question` is answerable
      // here, so the tool gets the kernel's answerer. This line is the whole
      // difference between `nova` and `nova exec` for that tool.
      userQuestions: true,
      ...(opts.persistConfig !== undefined ? { persistConfig: opts.persistConfig } : {}),
      // The shell's own plugins (the qqbot channel for `nova --web`). Passed
      // through rather than built here: this package must not know any channel.
      ...(opts.extraPlugins !== undefined ? { extraPlugins: [...opts.extraPlugins] } : {}),
    });
    // Hand the assembled kernel back to the shell BEFORE any session exists: a
    // contributed channel needs it to run a peer turn, and the channel had to be
    // built before the kernel (its plugin is part of the assembly).
    opts.onKernelReady?.(kernel);
    const controller = new WebController(
      kernel,
      new ModelSeat(kernel.models, opts.providerModelLabel, opts.contextWindow, opts.providerModelName),
      opts.version,
      opts.persistModel,
      opts.persistQqBot,
      // The qqbot diagnostic rides its own snapshot: a plugin whose `{env:NAME}`
      // did not resolve is reported in the panel that owns it (see
      // `pluginDiagnostics`), never as a startup failure.
      {
        ...opts.qqBotConfig,
        ...(opts.pluginDiagnostics?.['qqbot'] !== undefined ? { error: opts.pluginDiagnostics['qqbot'] } : {}),
      },
      opts.testQqBot,
      opts.recheckQqBot,
      // Live channel, or absent: without it a save writes the file and nothing
      // dials out (see the constructor's note).
      opts.qqBotRuntime,
      opts.persistModels,
      opts.readModels ?? (async () => []),
      opts.persistProviders,
      opts.readProviders ?? (async () => ({ providers: [] })),
      opts.storedApiKey ?? (() => undefined),
      opts.configuredModel ?? (() => undefined),
    );
    controller.followSession();
    return controller;
  }

  get agent(): AgentSession {
    return this.kernel.agent;
  }

  /** Close all clients and tear down the kernel (jobs disposed). */
  async dispose(): Promise<void> {
    this.follow.stop();
    this.clients.close();
    await this.kernel.jobs.dispose().catch(() => undefined);
  }

  // ----------------------------------------------------------------- sockets

  /** Register a freshly-upgraded socket: send `ready`, start streaming. */
  attach(client: WsConnection): void {
    this.clients.attach(client, this.readyFrame());
  }

  detach(client: WsConnection): void {
    this.clients.detach(client);
  }

  /** One validated inbound frame → zero or more kernel calls. Never throws. */
  async handle(client: WsConnection, frame: ClientFrame): Promise<void> {
    await handleFrame(client, frame, {
      agent: this.agent,
      kernel: this.kernel,
      seat: this.seat,
      sessions: this.sessions,
      pages: this.pages,
      persistModel: this.persistModel,
      persistQqBot: this.persistQqBot,
      qqBotSnapshot: () => this.qqBotSnapshot ?? {},
      setQqBotSnapshot: (snapshot) => { this.qqBotSnapshot = { ...snapshot }; },
      testQqBot: this.testQqBot,
      recheckQqBot: this.recheckQqBot,
      qqBotRuntime: this.qqBotRuntime,
      persistModels: this.persistModels,
      readModels: this.readModels,
      persistProviders: this.persistProviders,
      readProviders: this.readProviders,
      storedApiKey: this.storedApiKey,
      configuredModel: this.configuredModel,
      approvalDefault: () => this.approvalDefault,
      setApprovalDefault: (mode) => { this.approvalDefault = mode; },
      broadcast: (text) => { this.clients.broadcast(text); },
      readyFrame: () => this.readyFrame(),
      broadcastState: () => { this.broadcastState(); },
      switchSession: (opts) => this.switchSession(opts),
      abandonCurrentSession: () => this.abandonSession(),
    });
    // AFTER the frame: a workspace move replaces the session inside the kernel,
    // so follow it here rather than making every handler remember to.
    this.followSession();
  }

  /** Session-switch replies carry a fresh `ready` (new transcript baseline). */
  private async switchSession(opts: { resumeFile?: string }): Promise<void> {
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
    const doomed = this.kernel.agent;
    // Order matters: unsubscribe BEFORE dispose, so the closing session's own
    // terminal events are not broadcast as if they belonged to the new one.
    this.follow.stop();
    await doomed.dispose().catch(() => undefined);
    // Jobs belong to the session that started them; a deleted session's running
    // work has nowhere to report, so it is cancelled rather than left orphaned.
    await this.kernel.jobs.disposeSession(doomed.session.id).catch(() => undefined);
    await this.replaceSession({});
    this.clients.broadcast(this.readyFrame());
  }

  /**
   * Point the kernel at a session (fresh, or resumed) and follow it.
   *
   * Shared by switch and abandon so both apply the same three rules — workspace,
   * approval default, subscription — instead of drifting apart.
   */
  private async replaceSession(opts: { resumeFile?: string }): Promise<void> {
    const agent =
      opts.resumeFile !== undefined
        ? await this.kernel.newAgentSession({ resumeFile: opts.resumeFile })
        : await this.kernel.newAgentSession();
    // Resuming re-points the tools at the workspace that session was created
    // in (the marker it logged) — a surface decision, so not the kernel's.
    const workspace = opts.resumeFile !== undefined ? sessionWorkspace(agent.session) : undefined;
    if (workspace !== undefined && workspace !== this.kernel.rootDir() && !isInsideNovaHome(workspace)) {
      await this.kernel.setWorkspace(workspace).catch(() => undefined);
    }
    // A tier settings picked earlier is the default for the sessions created
    // after it — applied before the baseline ships, so `ready` names the tier
    // that is actually in force.
    if (this.approvalDefault !== undefined && agent.approvalMode !== this.approvalDefault) {
      agent.setApprovalMode(this.approvalDefault);
    }
    this.followSession();
  }

  /**
   * Follow the kernel's current session — whichever that now is.
   *
   * Idempotent, so a caller says "make sure I am following" rather than tracking
   * whether something replaced the session. The kernel can replace it on its
   * own: `setWorkspace` mints a fresh session for a still-blank one so its
   * context names the new workspace. A subscription pinned to the session bound
   * at boot would go silent at that moment — the transcript stops updating while
   * the kernel keeps working.
   */
  private followSession(): void {
    this.follow.follow(this.kernel.agent, (event) => {
      if (event.type === 'model') {
        // The seat follows the session, then every client is re-stated with the
        // same `state` frame the mode switches use — it answers the same
        // question: "what is in force right now".
        this.seat.apply(event.model, { ...(event.name !== undefined ? { name: event.name } : {}), ...(event.contextWindow !== undefined ? { contextWindow: event.contextWindow } : {}) });
        this.broadcastState();
      }
      this.clients.broadcast(serialize(wireFrame(this.kernel, event)));
    });
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
      }),
    });
  }

  private broadcastState(): void {
    this.clients.broadcast(serialize({
      type: 'state',
      approvalMode: this.agent.approvalMode ?? 'read-only',
      codeMode: this.kernel.codeMode(),
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
