/**
 * The UI state's public surface. The implementation is split by responsibility
 * under `./state/`:
 *
 *   - `state/types.ts`   — blocks, slices, UiState (the vocabulary)
 *   - `state/initial.ts` — the zero value
 *   - `state/actions.ts` — every input the reducer accepts
 *   - `state/reduce.ts`  — the frame fold
 *   - `state/ready.ts`   — the (re)attach fold + block helpers
 *
 * This barrel stays the ONE import path: consumers keep writing
 * `from '../state.js'`, so the split cannot leak into 31 call sites.
 */
export type {
  Block,
  SubRow,
  Draft,
  ModelCatalog,
  RosterSnapshot,
  UiState,
  SessionViewId,
  SkillsSnapshot,
  PluginsSnapshot,
  PluginRequestAnswer,
  GitState,
  ModelConfigSnapshot,
  ProvidersSnapshot,
  ProviderProbe,
  FileListState,
  PickReply,
  DirectoryState,
  TraceState,
  SessionTotals,
} from './state/types.js';
export { initialState } from './state/initial.js';
export type { Action } from './state/actions.js';
export { reduce } from './state/reduce.js';
