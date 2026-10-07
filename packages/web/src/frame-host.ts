/**
 * Every collaborator the inbound routing table reads, supplied by the controller.
 *
 * Split from `frame-router.ts` because this is a CONTRACT (what a controller must
 * be able to answer) while that file is a routing TABLE (which frame calls what).
 * The table grows with every frame; the contract grows with every collaborator,
 * and the two are read for different reasons.
 */
import type { AgentSession, ApprovalMode, ConfiguredModel, SessionListing } from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import type { GitStatusCache } from './git-frames.js';
import type { PluginFrameHost } from './plugin-frames.js';import type { ProviderHost } from './provider-frames.js';
import type { PickFn } from './picker-frames.js';
import type { ModelSeat } from './model-seat.js';
import type { SessionPages } from './session-pages.js';
import type { TermRegistry } from './term-session.js';
import type { ContextFollow } from './context-follow.js';

export interface FrameHost {
  agent: AgentSession;
  kernel: Kernel;
  seat: ModelSeat;
  sessions: SessionListing;
  pages: SessionPages;
  /**
   * The 终端 tab's live PTYs, one per session.
   *
   * Process-scoped like the pages: a terminal outlives any one socket (two
   * attached tabs share it) and dies with the session it belongs to, so the
   * controller owns the registry and hands the same instance to every routing
   * call.
   */
  terms: TermRegistry;
  /**
   * The 变更 tab's status reading. One cache per process, so the tab, the file
   * tree's decorations and a diff's untracked check all read the same answer.
   */
  gitCache: GitStatusCache;
  /** The Context panel's fold, kept in step with the log. */
  context: ContextFollow;
  /** Remember a switch past this process; absent with no durable home for it. */
  persistModel: ((model: string) => void | Promise<void>) | undefined;
  /** The operator's model list: its writer, and its on-demand reader. */
  persistModels: ((models: readonly ConfiguredModel[]) => void | Promise<void>) | undefined;
  readModels: () => Promise<readonly ConfiguredModel[]>;
  /** The session-TITLE model (config `titleModel`): writer (`null` clears) and reader. */
  persistTitleModel: ((model: string | null) => void | Promise<void>) | undefined;
  readTitleModel: () => Promise<string | null>;
  /**
   * Every plugin's operations, addressed by the id its config row uses.
   *
   * One port rather than a per-plugin one: the settings panel (and anything else
   * a plugin wants to answer) reaches a plugin through the kernel's own registry,
   * so a new plugin needs no new collaborator here.
   */
  pluginRpc: PluginFrameHost;
  /**
   * The BYOK provider list: its writer, its on-demand reader, the stored-key
   * lookup a probe or a switch reuses (the browser never holds a key), and the
   * applied-id tracking that makes "already in force" a fact about the live
   * client rather than the file.
   */
  persistProviders: ProviderHost['persistProviders'];
  readProviders: ProviderHost['readProviders'];
  storedApiKey: ProviderHost['storedApiKey'];
  configuredModel: ProviderHost['configuredModel'];
  liveProviderId: ProviderHost['liveProviderId'];
  setLiveProviderId: ProviderHost['setLiveProviderId'];
  /** The approval tier picked earlier — the default for later sessions. */
  approvalDefault(): ApprovalMode | undefined;
  setApprovalDefault(mode: ApprovalMode): void;
  /**
   * Open the host's native file/folder dialog (`pick_file` / `pick_directory`).
   * Undefined means the real one (`native-picker.ts`); tests inject a fake.
   */
  pickPath: PickFn | undefined;
  /** Send every attached client this text (a broadcast, not a reply). */
  broadcast(text: string): void;
  /** The current baseline frame, serialized. */
  readyFrame(): string;
  /** Re-state the model and the approval tier to every client. */
  broadcastState(): void;
  /** Replace the live session (a fresh log, or a resumed one). */
  switchSession(opts: { resumeFile?: string }): Promise<void>;
  /**
   * Delete the open session: dispose it, then start a fresh one. Distinct from
   * `switchSession`, which leaves the old session running (see `fs-frames.ts`).
   */
  abandonCurrentSession(): Promise<void>;
  /**
   * Dispose the live handle on a file that is NOT the open session, if one
   * exists — the delete path's guard against a switched-away session
   * recreating its own deleted log (see `session-frames.ts`).
   */
  disposeLiveHandle(file: string): Promise<void>;
  /**
   * Move the workspace for the session THIS surface serves.
   *
   * The controller's own method rather than a direct `kernel.setWorkspace`
   * call: the kernel moves ITS current session, which another surface may have
   * moved (see `controller.ts`'s `setWorkspace`), so the frame must be
   * addressed to the conversation the operator is looking at.
   */
  setWorkspace(dir: string): Promise<void>;
}
