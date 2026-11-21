/**
 * The frame fold: one case per Action, pure and React-free. Frame-level
 * bookkeeping lives here; kernel events are delegated to `state-events.ts` and
 * the per-domain answer shapes to `client/*` (the reducer still routes them,
 * because it is the only thing that sees both the request and its reply).
 */
import type { Action } from './actions.js';
import type { PluginRequestAnswer, UiState } from './types.js';
import { reduceEvent } from '../state-events.js';
import { sessionListAnswered, sessionListRequested } from '../client/sessions.js';
import { hostErrorText } from '../host-messages.js';
import { treeAsk, treeError, treeLevel } from '../rightbar/files-model.js';
import { closeDoc, docError, docLoaded, openDoc } from '../rightbar/editor-model.js';
import { applyReady, hint, replayBlock } from './ready.js';

export function reduce(state: UiState, action: Action): UiState {
  switch (action.type) {
    case 'connection':
      // `connected: false` is the whole action: the socket died, so every
      // control darkens and every in-flight flag the dead socket owned is
      // released (the reconnect's `ready` re-baselines them). There is no
      // `connected: true` arm to write — see the Action type.
      return {
        ...state,
        connected: false,
        // 'disconnected' is synthetic (not a kernel TurnPhase): the reconnect's
        // `ready` replaces it with the real phase.
        phase: 'disconnected',
        // A dropped socket means the reply cannot arrive: unblock the button
        // rather than leave it spinning until the reconnect re-baselines.
        historyPending: false,
        // Same rule for the trace page: a dropped socket cannot deliver it.
        trace: state.trace !== null ? { ...state.trace, pending: false } : state.trace,
        // …and for the directory picker, where a stuck flag is worse than a
        // spinner: the dialog gates its own opening ask on `!pending` and
        // disables both 新建文件夹 and 打开 while it is set, so a disconnect during
        // a listing left the reader in a dead end that only closing and
        // reopening could escape.
        directory: state.directory !== null ? { ...state.directory, pending: false } : state.directory,
        // A dropped socket cannot deliver the `picked` reply either.
        pickPending: false,
      };
    case 'sent':
      if (action.frame.type === 'load_earlier') return { ...state, historyPending: true };
      // A trace read going out marks its own page in flight; rows already held
      // stay on screen (the pane shows them under the refresh).
      if (action.frame.type === 'load_trace') {
        return {
          ...state,
          trace: {
            rows: state.trace?.rows ?? [],
            total: state.trace?.total ?? 0,
            pending: true,
            have: action.frame.have,
          },
        };
      }
      if (action.frame.type === 'list_sessions') {
        // Same rule as the catalog: the request went out, so the answer is
        // what settles it — and the list stays on screen until it does.
        // (The rule lives in the sessions domain: `client/sessions.ts`.)
        return sessionListRequested(state);
      }
      if (action.frame.type === 'list_files') {
        // The in-flight flag rides the query: the menu shows its loading row
        // only while the answer on screen is for the text being typed.
        return { ...state, files: { query: action.frame.query, items: [], truncated: false, pending: true } };
      }
      if (action.frame.type === 'read_entry') {
        // The document enters the editor the moment the read goes OUT (it
        // renders as loading); the host's `entry` / `entry_error` then settles
        // the doc that is already there. Opening it here, on the request, is
        // what gives the gesture one owner: every caller of `read_entry` — the
        // tree row, its kebab menu, anything later — gets an open document,
        // and an answer for a path nobody asked about still cannot conjure one.
        return { ...state, editor: openDoc(state.editor, action.frame.path) };
      }
      if (action.frame.type === 'list_directory' && action.frame.dir !== undefined) {
        // The right panel's tree marks the level it is waiting for, so its row
        // shows a loading line instead of looking like an empty directory. The
        // picker's own asks (`directory_ask`) keep their separate flag: they are
        // one level at a time and the dialog owns that gesture.
        return { ...state, tree: treeAsk(state.tree, action.frame.dir) };
      }
      if (action.frame.type === 'probe_provider') {
        // The provider probe's in-flight flag rides its ADDRESS for the same
        // reason: the round trip outlives an edit, and an answer for text the
        // operator has since changed must not be shown against the new address.
        return {
          ...state,
          providerProbe: { baseURL: action.frame.baseURL, ok: false, models: [], pending: true },
        };
      }
      // Opening the catalog marks the fetch in flight HERE, not in the menu:
      // the reducer sees the request go out and the reply come back, so a menu
      // closed and reopened cannot show a stale answer as fresh.
      if (action.frame.type === 'list_models') {
        return { ...state, catalog: { groups: state.catalog?.groups ?? [], loading: true } };
      }
      // The native-dialog ask marks itself in flight: the guard against a second
      // dialog reads it, and only the `picked` reply (or a disconnect) settles it.
      if (action.frame.type === 'pick_file' || action.frame.type === 'pick_directory') {
        return { ...state, pickPending: true };
      }
      // A plugin operation marks itself in flight the moment it goes out. Without
      // this the entry kept whatever the last REPLY said, so `pending` was never
      // true: the save button never swapped to 保存中…, the action buttons never
      // swapped to 执行中…, and every write read as a dead control — the reported
      // 「按钮点不点让人完全没反应」. The plugin's own answer replaces this entry
      // (the `plugin_answer` case), which is what settles it.
      if (action.frame.type === 'plugin_request') {
        return {
          ...state,
          pluginAnswers: {
            ...state.pluginAnswers,
            [action.frame.plugin]: { id: action.frame.id, op: action.frame.op, ok: false, pending: true },
          },
        };
      }
      // A prompt or command parks the echo wait: the kernel either echoes it
      // (its `user_message` / command `run` row lands) or refuses it (an
      // `error` frame arrives with nothing echoed). Every other frame type is
      // answered by a reply of its own and needs no echo bookkeeping.
      if (action.frame.type === 'prompt' || action.frame.type === 'command') {
        return { ...state, awaitingEcho: true };
      }
      return state;
    case 'ready':
      return applyReady(state, action.info);
    case 'event':
      return reduceEvent(state, action.event, action.view, action.resultView);
    case 'state':
      return {
        ...state,
        approvalMode: action.approvalMode,
        model: action.model,
        // No name in the frame means the host has none for this model: keeping
        // the previous model's would label the new one with the old one's name.
        modelName: action.modelName ?? null,
      };
    case 'models':
      return {
        ...state,
        model: action.current,
        catalog: {
          groups: action.groups,
          loading: false,
          ...(action.error !== undefined ? { error: action.error } : {}),
        },
      };
    case 'model_config':
      return {
        ...state,
        modelConfig: {
          models: action.models,
          published: action.published,
          automatic: action.automatic,
          titleModel: action.titleModel,
        },
        manageError: null,
      };
    case 'providers':
      return {
        ...state,
        providers: {
          providers: action.providers,
          ...(action.activeId !== undefined ? { activeId: action.activeId } : {}),
        },
      };
    case 'provider_probe':
      return {
        ...state,
        providerProbe: {
          baseURL: action.baseURL,
          ok: action.ok,
          models: action.models,
          ...(action.message !== undefined ? { message: action.message } : {}),
          pending: false,
        },
      };
    case 'roster':
      return { ...state, roster: { entries: action.entries, configPath: action.configPath } };
    case 'plugins':
      // A flip's answer re-states BOTH halves: the roster snapshot (which the
      // manager draws) and the full `roster` frame's rows (which `/plugins`
      // parity reads) — one answer, no second ask.
      return {
        ...state,
        plugins: { entries: action.entries, disable: action.disable },
        roster: state.roster !== null ? { entries: action.entries, configPath: state.roster.configPath } : state.roster,
      };
    case 'skills':
      return { ...state, skills: { items: action.items, disable: action.disable } };
    case 'plugin_answer': {
      // A LATE answer is dropped, not applied. Ids are globally monotonic (the
      // id source never restarts, not even across section remounts — see
      // `settings/plugin-request-id.ts`), so an answer older than the newest
      // one this plugin already holds belongs to a request the page has moved
      // past: reopening the page must not let a slow reply to the PREVIOUS
      // mount overwrite the fresh one.
      const current = state.pluginAnswers[action.plugin];
      if (current !== undefined && current.id > action.id) return state;
      const answer: PluginRequestAnswer = {
        id: action.id,
        op: action.op,
        ok: action.ok,
        ...(action.result !== undefined ? { result: action.result } : {}),
        ...(action.error !== undefined ? { error: action.error } : {}),
      };
      return { ...state, pluginAnswers: { ...state.pluginAnswers, [action.plugin]: answer } };
    }
    case 'plugin_edit': {
      // Only ACTION answers are dropped: `page` describes the plugin and stays
      // until the plugin itself replaces it.
      const kept: Record<string, PluginRequestAnswer | undefined> = {};
      for (const [plugin, answer] of Object.entries(state.pluginAnswers)) {
        if (answer !== undefined && answer.op === 'page') kept[plugin] = answer;
      }
      return { ...state, pluginAnswers: kept };
    }
    case 'sessions':
      // The answer settles both flags — the rule lives in the sessions domain
      // (`client/sessions.ts`).
      return sessionListAnswered(state, action.items);
    case 'files':
      // A reply for text the user has already typed past is dropped: replacing
      // the rows now would show candidates for a query nobody is asking.
      if (state.files !== null && state.files.pending && state.files.query !== action.query) return state;
      return { ...state, files: { query: action.query, items: action.items, truncated: action.truncated, pending: false } };
    case 'directory_open':
      // Closing drops the level: the host may have changed underneath (another
      // tool created a folder), and a stale tree shown as current is worse than
      // one re-asked for. Opening keeps whatever was there for the same reason
      // the session list survives a reconnect.
      return action.open
        ? { ...state, directory: state.directory ?? { level: null, error: null, pending: false, mode: action.mode ?? 'directory' } }
        : { ...state, directory: null };
    case 'directory_ask':
      // Only the open picker can be mid-ask (its own effect is the only caller):
      // a null slot stays null, so no path can conjure the dialog into being.
      return {
        ...state,
        directory: state.directory === null ? null : {
          level: state.directory.level ?? null,
          error: null,
          pending: true,
          mode: state.directory.mode,
        },
      };
    case 'directory':
      // The error clears because a level DID arrive: the previous refusal was
      // about a different path. The same answer feeds the right panel's tree
      // (keyed by the host's own absolute path): one frame, two readers, and no
      // second ask — the picker and the panel may both have one in flight.
      //
      // **The picker's slot is only written while the picker is OPEN.** The tree
      // asks these same frames for its own levels, and filling the slot from an
      // answer is what made the dialog appear out of nowhere: opening the right
      // panel (whose 文件 page asks for the workspace root) drew 「选择工作区文件夹」
      // over a session that already had a workspace — the reported 「文件页面居然
      // 需要我再选择一遍」. A dialog is opened by a GESTURE (`directory_open`), never
      // by an answer to somebody else's question.
      return {
        ...state,
        tree: treeLevel(state.tree, action.level),
        directory: state.directory === null ? null : {
          level: action.level,
          error: null,
          pending: false,
          mode: state.directory.mode,
        },
      };
    case 'directory_error':
      // The previous level is kept: a failed navigation returns the user to
      // where they were with the reason stated, not to a blank dialog. The tree
      // marks whatever it was waiting for as refused (the frame carries no path;
      // see `files-model.treeError`). Same rule as the answer above: a refusal
      // for the tree's own ask must not open the picker.
      return {
        ...state,
        tree: treeError(state.tree, action.message),
        directory: state.directory === null ? null : {
          level: state.directory.level,
          error: action.message,
          pending: false,
          mode: state.directory.mode,
        },
      };
    case 'picked': {
      const { type: _picked, ...reply } = action;
      return { ...state, pickPending: false, pick: reply };
    }
    case 'entry':
      return { ...state, editor: docLoaded(state.editor, action) };
    case 'entry_error':
      return { ...state, editor: docError(state.editor, action.path, action.message) };
    case 'entry_changed': {
      // The change happened in one directory; marking that level as needing a
      // fresh read is the whole update — the panel's own effect asks, and the
      // answer (a `directory` frame) is what the tree renders from. A removed
      // OPEN document is closed too: its rows would otherwise sit on a file
      // that no longer exists.
      const editor = action.change === 'removed' ? closeDoc(state.editor, action.path) : state.editor;
      return { ...state, editor, tree: treeAsk(state.tree, action.dir) };
    }
    case 'git_status':
      return {
        ...state,
        git: {
          root: state.meta?.rootDir ?? '',
          repo: action.repo,
          branch: action.branch,
          entries: action.entries,
        },
      };
    case 'editor_close':
      return { ...state, editor: closeDoc(state.editor, action.path) };
    case 'history_earlier': {
      // Older blocks go in FRONT; the cursor is what the browser now holds.
      let seq = state.seq;
      const older = action.blocks.map((entry) => replayBlock(entry, `b${(seq += 1)}`));
      return {
        ...state,
        blocks: [...older, ...state.blocks],
        seq,
        historyLoaded: state.historyLoaded + action.blocks.length,
        historyTotal: action.total,
        historyPending: false,
      };
    }
    case 'trace':
      // Which request this answers is decided by the cursor it was sent with,
      // not by guessing from the payload: `have: 0` asked for a fresh read (the
      // page IS the newest tail and replaces what was held), any other cursor
      // asked for the rows immediately older than those (they go in FRONT).
      return {
        ...state,
        trace: {
          rows: state.trace !== null && state.trace.have > 0
            ? [...action.rows, ...state.trace.rows]
            : action.rows,
          total: action.total,
          pending: false,
          have: state.trace !== null && state.trace.have > 0 ? state.trace.have + action.rows.length : action.rows.length,
        },
      };
    case 'context':
      // A null reading is REAL: the plugin is off, so the panel must drop its
      // tab (a view stuck on `context` would draw a pane with no data). When the
      // panel is not in front, the reading is still kept — the tab shows the
      // composition as a strip until it is opened.
      return {
        ...state,
        context: action.timeline,
        ...(action.timeline === null && state.view === 'context' ? { view: 'chat' } : {}),
      };
    case 'select_view':
      return { ...state, view: action.view };
    case 'error': {
      // A host error IS the reply to whatever was in flight: it settles too.
      // It also settles a management flip (see `manageError`): the refusal IS
      // that switch's whole answer, so the section must release its in-flight
      // state on it — otherwise the control it disabled stays disabled forever.
      const seq = (state.manageError?.seq ?? 0) + 1;
      return {
        ...hint(state, hostErrorText(action.message), 'warn'),
        manageError: { seq, message: action.message },
        historyPending: false,
        sessionsPending: false,
        trace: state.trace !== null ? { ...state.trace, pending: false } : null,
        // An error IS a reply. When it settles a send that never got its echo,
        // the composer's optimistically cleared draft is owed a restore: the
        // counter (not a boolean) is what makes a second rejection — even of
        // the same text — observable too.
        ...(state.awaitingEcho ? { sendRejected: state.sendRejected + 1, awaitingEcho: false } : {}),
      };
    }
  }
}
