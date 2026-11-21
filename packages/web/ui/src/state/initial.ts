/**
 * The zero value of the UI state: one literal so every slice's initial shape is
 * visible in one place (and so tests can start from the same state the app does).
 */
import { emptyTotals } from '@nova-agent/core/totals';
import { emptyTree } from '../rightbar/files-model.js';
import { emptyEditor } from '../rightbar/editor-model.js';
import type { UiState } from './types.js';

export const initialState: UiState = {
  connected: false,
  meta: null,
  approvalMode: 'read-only',
  model: '',
  modelName: null,
  modelSwitching: false,
  catalog: null,
  roster: null,
  plugins: null,
  skills: null,
  manageError: null,
  pluginAnswers: {},
  modelConfig: null,
  providers: null,
  providerProbe: null,
  commands: [],
  todos: null,
  goal: null,
  blocks: [],
  seq: 0,
  phase: 'idle',
  pendingApproval: null,
  pendingQuestion: null,
  queued: [],
  turnCount: 0,
  awaitingEcho: false,
  sendRejected: 0,
  usedTokens: 0,
  contextWindow: null,
  sessions: null,
  sessionsStale: false,
  sessionsPending: false,
  historyLoaded: 0,
  historyTotal: 0,
  historyPending: false,
  view: 'chat',
  trace: null,
  context: null,
  files: null,
  directory: null,
  pickPending: false,
  pick: null,
  tree: emptyTree,
  editor: emptyEditor(),
  git: null,
  totals: emptyTotals,
};
