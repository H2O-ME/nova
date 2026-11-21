/**
 * Every input the reducer accepts. One union, because the reducer's
 * exhaustiveness check is the thing that makes a forgotten action a compile
 * error; the domains are grouped by comment, not by separate types.
 */
import type {
  ApprovalMode, ClientFrame, ConfiguredModel, ContextTimeline,
  GitStatusEntry, KernelEvent, ModelCapabilities, ModelGroup, ReadyInfo,
  SessionListItem, ToolCallView, ToolResultView, WireBlock, WireDirectoryLevel,
  WireFileEntry, WireProviderRow, WireRosterEntry, WireSkillEntry, WireTraceRow,
} from '../types.js';
import type { SessionViewId } from './types.js';

export type Action =
  /** The socket DIED. Lighting `connected` is `ready`'s job alone (applyReady):
   *  a socket that is open but not yet attached answers nothing, so it must
   *  not unlock a single control. */
  | { type: 'connection'; connected: false }
  /** A frame the client just put on the socket — request-side state the
   *  server's replies alone cannot account for (the pagination in-flight flag). */
  | { type: 'sent'; frame: ClientFrame }
  | { type: 'ready'; info: ReadyInfo }
  | { type: 'event'; event: KernelEvent; view?: ToolCallView; resultView?: ToolResultView }
  | { type: 'state'; approvalMode: ApprovalMode; model: string; modelName?: string }
  | { type: 'models'; groups: readonly ModelGroup[]; current: string; error?: string }
  | { type: 'roster'; entries: readonly WireRosterEntry[]; configPath: string }
  | { type: 'plugins'; entries: readonly WireRosterEntry[]; disable: readonly string[] }
  | { type: 'skills'; items: readonly WireSkillEntry[]; disable: readonly string[] }

  | { type: 'model_config'; models: readonly ConfiguredModel[]; published: readonly string[]; automatic: Readonly<Record<string, ModelCapabilities>>; titleModel: string | null }
  | { type: 'providers'; providers: readonly WireProviderRow[]; activeId?: string }
  /** The host's answer to `probe_provider` (success or reason), same shape. */
  | { type: 'provider_probe'; baseURL: string; ok: boolean; models: readonly string[]; message?: string }
  /**
   * One plugin operation's answer. `pending` marks the browser's own ask so a
   * control can disable itself while its request is in flight.
   */
  | {
      type: 'plugin_answer';
      plugin: string;
      id: number;
      op: string;
      ok: boolean;
      result?: unknown;
      error?: string;
    }
  /**
   * The operator edited a field on a plugin's page: whatever the last ACTION
   * answered no longer describes what is on screen (a probe result belongs to the
   * exact text it tested). The `page` descriptor is kept — dropping it would
   * blank the form the operator is typing into.
   */
  | { type: 'plugin_edit' }
  | { type: 'sessions'; items: readonly SessionListItem[] }
  | { type: 'files'; query: string; items: readonly WireFileEntry[]; truncated: boolean }
  | { type: 'directory'; level: WireDirectoryLevel }
  | { type: 'directory_error'; message: string }
  /** The host's native dialog answered (`picked` frame). */
  | { type: 'picked'; kind: 'file' | 'directory'; path?: string; error?: string }
  /**
   * The user opened a directory request (navigated, or created a folder). A
   * local action: it marks the request in flight HERE, because the reducer is
   * the only place that sees both the intent and the frame that settles it.
   */
  | { type: 'directory_ask' }
  /** The directory browser opened or closed; closing drops the fetched level. */
  | { type: 'directory_open'; open: boolean; mode?: 'directory' | 'file' }
  | { type: 'history_earlier'; blocks: readonly WireBlock[]; total: number }
  | { type: 'trace'; rows: readonly WireTraceRow[]; total: number }
  | { type: 'context'; timeline: ContextTimeline | null }
  /** One file's content settled a read (the answer to `read_entry`). */
  | { type: 'entry'; path: string; text: string; bytes: number; truncated: boolean; binary: boolean }
  /** A read the host refused; the document stays open showing the reason. */
  | { type: 'entry_error'; path: string; message: string }
  /**
   * A structural change (rename/remove/create): the directory it happened in is
   * marked for re-listing, so the tree refreshes from an answer rather than
   * from the click — the panel's own `needsListing` effect picks the ask up.
   */
  | { type: 'entry_changed'; change: 'renamed' | 'removed' | 'created'; path: string; dir: string }
  /** The workspace's git status (the tree's decorations). */
  | { type: 'git_status'; repo: boolean; branch: string; entries: readonly GitStatusEntry[] }
  /** The user closed a file tab (the tab is the strip's; the doc leaves too). */
  | { type: 'editor_close'; path: string }
  /**
   * The user picked a view. A local action, not a frame: the host has no
   * opinion about which pane is on screen, and nothing about it is durable.
   */
  | { type: 'select_view'; view: SessionViewId }
  | { type: 'error'; message: string };
