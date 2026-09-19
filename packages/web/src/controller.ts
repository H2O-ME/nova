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
import path from 'node:path';
import {
  callViewOf,
  isInsideNovaHome,
  listRecentSessions,
  resultViewOf,
  sessionWorkspace,
  sessionsRoot,
  type AgentSession,
  type KernelEvent,
} from '@nova-agent/core';
import { createAgentKernel, type Kernel } from '@nova-agent/plugins';
import { toAskResult, type ClientFrame, type ReadyInfo, type ServerFrame } from './protocol.js';
import { projectTranscript } from './transcript.js';
import type { WsConnection } from './ws.js';
import type { ControllerOptions } from './options.js';

const SESSION_LIST_LIMIT = 30;

export class WebController {
  private readonly kernel: Kernel;
  private readonly clients = new Set<WsConnection>();
  private unsubscribe: (() => void) | undefined;
  /** A frame the client sends before its run starts (used only to echo model). */
  private readonly modelLabel: string;
  private readonly bindAffinity: ((sessionId: string) => void) | undefined;
  private readonly contextWindow: number | undefined;

  private constructor(
    kernel: Kernel,
    modelLabel: string,
    bindAffinity: ((sessionId: string) => void) | undefined,
    contextWindow: number | undefined,
  ) {
    this.kernel = kernel;
    this.modelLabel = modelLabel;
    this.bindAffinity = bindAffinity;
    this.contextWindow = contextWindow;
  }

  static async create(opts: ControllerOptions): Promise<WebController> {
    const kernel = await createAgentKernel({
      rootDir: opts.rootDir,
      provider: opts.provider,
      config: opts.config,
      ...(opts.resumeFile !== undefined ? { resumeFile: opts.resumeFile } : {}),
    });
    const controller = new WebController(kernel, opts.providerModelLabel, opts.bindSessionAffinity, opts.contextWindow);
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
    client.send(serialize({ type: 'ready', info: this.readyInfo() }));
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
          if (!this.agent.resolveApproval(frame.id, toAskResult(frame.answer))) {
            client.send(serialize({ type: 'error', message: `unknown approval id: ${frame.id}` }));
          }
          break;
        case 'compact':
          await this.agent.compact('manual');
          break;
        case 'list_sessions': {
          const sessions = await listRecentSessions(sessionsRoot(), SESSION_LIST_LIMIT);
          client.send(
            serialize({
              type: 'sessions',
              items: sessions.map((s) => ({ file: s.file, title: s.title, mtime: s.mtime })),
            }),
          );
          break;
        }
        case 'resume':
          await this.switchSession({ resumeFile: this.assertResumable(frame.file) });
          break;
        case 'new_session':
          await this.switchSession({});
          break;
        case 'set_approval_mode':
          this.agent.setApprovalMode(frame.mode);
          this.broadcastState();
          break;
        case 'set_code_mode':
          await this.kernel.setCodeMode(frame.mode);
          this.broadcastState();
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
    this.broadcast(serialize({ type: 'ready', info: this.readyInfo() }));
  }

  /** Reject any path outside ~/.nova/sessions — resume must be a Nova log. */
  private assertResumable(file: string): string {
    const resolved = path.resolve(file);
    const rel = path.relative(sessionsRoot(), resolved);
    if (rel.length === 0 || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('resume path is outside the sessions dir');
    }
    return resolved;
  }

  private readyInfo(): ReadyInfo {
    const agent = this.agent;
    return {
      rootDir: this.kernel.rootDir(),
      sessionFile: agent.session.file,
      model: this.modelLabel,
      approvalMode: agent.approvalMode ?? 'read-only',
      codeMode: this.kernel.codeMode(),
      history: projectTranscript(agent.messages, this.kernel.host.tools),
      pendingApprovals: agent.pendingApprovals(),
      usedTokens: agent.lastPromptTokens,
      ...(this.contextWindow !== undefined ? { contextWindow: this.contextWindow } : {}),
    };
  }

  private subscribeTo(agent: AgentSession): void {
    this.unsubscribe?.();
    this.unsubscribe = agent.subscribe((event) => {
      this.broadcast(serialize(this.wireFrame(event)));
    });
    // The live session owns the provider's affinity identity (per-session
    // prompt_cache_key / x-session-id headers).
    this.bindAffinity?.(agent.session.id);
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
      serialize({ type: 'state', approvalMode: this.agent.approvalMode ?? 'read-only', codeMode: this.kernel.codeMode() }),
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
