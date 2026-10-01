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
import type { ManageHost, QqBotSnapshot } from './manage-frames.js';
import type { ProviderHost } from './provider-frames.js';
import type { PickFn } from './picker-frames.js';
import type { ModelSeat } from './model-seat.js';
import type { SessionPages } from './session-pages.js';
import type { ContextFollow } from './context-follow.js';

export interface FrameHost {
  agent: AgentSession;
  kernel: Kernel;
  seat: ModelSeat;
  sessions: SessionListing;
  pages: SessionPages;
  /** The Context panel's fold, kept in step with the log. */
  context: ContextFollow;
  /** Remember a switch past this process; absent with no durable home for it. */
  persistModel: ((model: string) => void | Promise<void>) | undefined;
  /** The operator's model list: its writer, and its on-demand reader. */
  persistModels: ((models: readonly ConfiguredModel[]) => void | Promise<void>) | undefined;
  readModels: () => Promise<readonly ConfiguredModel[]>;
  /** The qqbot page's config writer/snapshot/probe (absent with no home). */
  persistQqBot: ((opts: { appId?: string; clientSecret?: string }) => void | Promise<void>) | undefined;
  qqBotSnapshot(): QqBotSnapshot;
  setQqBotSnapshot(snapshot: QqBotSnapshot): void;
  testQqBot: ((opts: { appId: string; clientSecret: string }) => Promise<string>) | undefined;
  /** Re-derive the qqbot problem from disk after a save (see `ManageHost`). */
  recheckQqBot: (() => Promise<string | undefined>) | undefined;
  /**
   * The live QQ channel this process runs, when it runs one.
   *
   * `recheckQqBot` answers "are the stored credentials usable" — a question about
   * the file. This one answers the two the file cannot: whether the gateway is up
   * (the page reads 未配置 / 已配置但未启动 / 运行中), and what a save does next.
   */
  qqBotRuntime: ManageHost['qqBotRuntime'];
  /**
   * The BYOK provider list: its writer, its on-demand reader, and the stored-key
   * lookup a probe or a switch reuses (the browser never holds a key).
   */
  persistProviders: ProviderHost['persistProviders'];
  readProviders: ProviderHost['readProviders'];
  storedApiKey: ProviderHost['storedApiKey'];
  configuredModel: ProviderHost['configuredModel'];
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
  /** Re-state the model and both modes to every client. */
  broadcastState(): void;
  /** Replace the live session (a fresh log, or a resumed one). */
  switchSession(opts: { resumeFile?: string }): Promise<void>;
  /**
   * Delete the open session: dispose it, then start a fresh one. Distinct from
   * `switchSession`, which leaves the old session running (see `fs-frames.ts`).
   */
  abandonCurrentSession(): Promise<void>;
}
