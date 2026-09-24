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
 */
import {
  callViewOf,
  isInsideNovaHome,
  SessionListing,
  resultViewOf,
  sessionLogPath,
  sessionsRoot,
  sessionWorkspace,
  type AgentSession,
  type KernelEvent,
} from '@nova-agent/core';
import { createAgentKernel, type Kernel } from '@nova-agent/plugins';
import { ModelSeat } from './model-seat.js';
import { assembleReady } from './ready.js';
import { SessionPages } from './session-pages.js';
import type { ClientFrame, ServerFrame } from './protocol.js';
import type { WsConnection } from './ws.js';
import type { ControllerOptions } from './options.js';

const SESSION_LIST_LIMIT = 30;

export class WebController {
  private readonly kernel: Kernel;
  private readonly clients = new Set<WsConnection>();
  private unsubscribe: (() => void) | undefined;
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

  private constructor(kernel: Kernel, seat: ModelSeat) {
    this.kernel = kernel;
    this.seat = seat;
  }

  static async create(opts: ControllerOptions): Promise<WebController> {
    const kernel = await createAgentKernel({
      rootDir: opts.rootDir,
      provider: opts.provider,
      config: opts.config,
      ...(opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : {}),
      ...(opts.modelCatalog !== undefined ? { modelCatalog: opts.modelCatalog } : {}),
    });
    const controller = new WebController(
      kernel,
      new ModelSeat(kernel.models, opts.providerModelLabel, opts.contextWindow, opts.providerModelName),
    );
    controller.subscribeTo(kernel.agent);
    return controller;
  }

  get agent(): AgentSession {
    return this.kernel.agent;
  }

  /** Close all clients and tear down the kernel (jobs disposed). */
  async dispose(): Promise<void> {
    this.unsubscribe?.();
    for (const client of this.clients) client.close();
    this.clients.clear();
    await this.kernel.jobs.dispose().catch(() => undefined);
  }

  // ----------------------------------------------------------------- sockets

  /** Register a freshly-upgraded socket: send `ready`, start streaming. */
  attach(client: WsConnection): void {
    this.clients.add(client);
    client.send(serialize({ type: 'ready', info: assembleReady({ agent: this.agent, kernel: this.kernel, seat: this.seat, pages: this.pages }) }));
  }

  detach(client: WsConnection): void {
    this.clients.delete(client);
  }

  /** One validated inbound frame → zero or more kernel calls. Never throws. */
  async handle(client: WsConnection, frame: ClientFrame): Promise<void> {
    try {
      switch (frame.type) {
        case 'prompt':
          await this.agent.prompt(frame.text);
          break;
        case 'abort':
          this.agent.abort();
          break;
        case 'resolve_approval':
          // The frame already carries a parsed `AskResult` — protocol.ts runs
          // core's `parseAskResult` on the wire — so nothing re-normalizes here.
          if (!this.agent.resolveApproval(frame.id, frame.answer)) {
            client.send(serialize({ type: 'error', message: `unknown approval id: ${frame.id}` }));
          }
          break;
        case 'compact':
          await this.agent.compact('manual');
          break;
        case 'list_sessions': {
          const sessions = await this.sessions.list(SESSION_LIST_LIMIT);
          client.send(
            serialize({
              type: 'sessions',
              items: sessions.map((s) => ({
                file: s.file,
                title: s.title,
                mtime: s.mtime,
                ...(s.workspace !== undefined ? { workspace: s.workspace } : {}),
              })),
            }),
          );
          break;
        }
        case 'resume':
          await this.switchSession({ resumeFile: sessionLogPath(frame.file) });
          break;
        case 'new_session':
          await this.switchSession({});
          break;
        case 'load_earlier': {
          const page = this.pages.earlierThan(frame.have);
          client.send(serialize({ type: 'history_earlier', blocks: page.items, total: page.total }));
          break;
        }
        case 'load_trace': {
          const page = this.pages.trace(frame.have, this.agent.session.events);
          client.send(serialize({ type: 'trace', rows: page.items, total: page.total }));
          break;
        }
        case 'set_approval_mode':
          this.agent.setApprovalMode(frame.mode);
          this.broadcastState();
          break;
        case 'set_code_mode':
          await this.kernel.setCodeMode(frame.mode);
          this.broadcastState();
          break;
        case 'list_models':
          client.send(serialize({ type: 'models', ...(await this.seat.list()) }));
          break;
        case 'set_model':
          // The kernel announces the switch on its event stream; that event
          // carries the new label back to every attached client.
          await this.seat.select(frame.model);
          break;
        case 'command':
          // The registry's row (a `command` event pair) is the reporting; a
          // refused or unknown name reports there too, so the caller's click
          // always lands somewhere the reader can see.
          await this.kernel.runCommand(frame.name, frame.args);
          break;
        case 'stop_job':
          // Unknown/settled ids are a no-op: the control is optimistic, and the
          // authoritative answer always arrives as a `job_update`.
          await this.agent.stopJob(frame.id);
          break;
      }
    } catch (err) {
      client.send(serialize({ type: 'error', message: errMessageText(err) }));
    }
  }

  /** Session-switch replies carry a fresh `ready` (new transcript baseline). */
  private async switchSession(opts: { resumeFile?: string }): Promise<void> {
    const agent =
      opts.resumeFile !== undefined
        ? await this.kernel.newAgentSession({ resumeFile: opts.resumeFile })
        : await this.kernel.newAgentSession();
    // Resuming re-points the tools at the workspace that session was created
    // in (the marker it logged). The kernel deliberately does not do this on
    // its own — which session is "the same workspace" is a surface decision.
    const workspace = opts.resumeFile !== undefined ? sessionWorkspace(agent.session) : undefined;
    if (workspace !== undefined && workspace !== this.kernel.rootDir() && !isInsideNovaHome(workspace)) {
      await this.kernel.setWorkspace(workspace).catch(() => undefined);
    }
    this.subscribeTo(agent);
    this.broadcast(serialize({ type: 'ready', info: assembleReady({ agent: this.agent, kernel: this.kernel, seat: this.seat, pages: this.pages }) }));
  }

  private subscribeTo(agent: AgentSession): void {
    this.unsubscribe?.();
    this.unsubscribe = agent.subscribe((event) => {
      if (event.type === 'model') {
        // The seat follows the session, then every client is re-stated with the
        // same `state` frame the mode switches use — it answers the same
        // question: "what is in force right now".
        this.seat.apply(event.model, { ...(event.name !== undefined ? { name: event.name } : {}), ...(event.contextWindow !== undefined ? { contextWindow: event.contextWindow } : {}) });
        this.broadcastState();
      }
      this.broadcast(serialize(this.wireFrame(event)));
    });
  }

  /**
   * Attach render intent to the two tool events. Resolved here, from the LIVE
   * registry (`host.tools` is re-read every event — a workspace switch or a PTC
   * rebuild swaps the host), so no surface re-derives per-tool knowledge.
   */
  private wireFrame(event: KernelEvent): ServerFrame {
    if (event.type === 'tool_call_start') {
      return { type: 'event', event, view: callViewOf(this.kernel.host.tools, event.call) };
    }
    if (event.type === 'tool_call_result') {
      return { type: 'event', event, resultView: resultViewOf(this.kernel.host.tools, event.call, event.result.content) };
    }
    return { type: 'event', event };
  }

  private broadcastState(): void {
    this.broadcast(
      serialize({
        type: 'state',
        approvalMode: this.agent.approvalMode ?? 'read-only',
        codeMode: this.kernel.codeMode(),
        model: this.seat.model,
        // Only when there IS a catalog name: the field means "metadata exists",
        // so a reader can fall back to the id without re-deriving the rule.
        ...(this.seat.name !== this.seat.model ? { modelName: this.seat.name } : {}),
      }),
    );
  }

  private broadcast(text: string): void {
    for (const client of this.clients) client.send(text);
  }
}

function serialize(frame: ServerFrame): string {
  return JSON.stringify(frame);
}

function errMessageText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Re-export for the server's event fanout typing (keeps KernelEvent local). */
export type { KernelEvent };
