/**
 * Server frame → reducer action: the browser's ONE routing table. It lives
 * apart from the socket (`client.ts`) because the socket is untestable here and
 * this table is pure — and because the table is where a new frame gets
 * forgotten. The `Mapper` record type makes that a compile error: every variant
 * of `ServerFrame` must have an entry, so a frame the host learned to send
 * cannot be silently dropped by a client that never learned to read it (which
 * is exactly how the trace view's first live run showed an empty log).
 *
 * `null` is a frame this surface deliberately does not act on; sneaking one in
 * as `null` is a decision, not an omission.
 */
import type { Action } from './state.js';
import type { ServerFrame } from './types.js';

type Of<K extends ServerFrame['type']> = Extract<ServerFrame, { type: K }>;

/** One mapper per frame type; the record's key set IS `ServerFrame['type']`. */
type Mapper = { readonly [K in ServerFrame['type']]: (frame: Of<K>) => Action | null };

const MAPPERS: Mapper = {
  ready: (frame) => ({ type: 'ready', info: frame.info }),
  event: (frame) => ({
    type: 'event',
    event: frame.event,
    ...(frame.view !== undefined ? { view: frame.view } : {}),
    ...(frame.resultView !== undefined ? { resultView: frame.resultView } : {}),
  }),
  state: (frame) => ({
    type: 'state',
    approvalMode: frame.approvalMode,
    codeMode: frame.codeMode,
    model: frame.model,
    ...(frame.modelName !== undefined ? { modelName: frame.modelName } : {}),
  }),
  models: (frame) => ({
    type: 'models',
    groups: frame.groups,
    current: frame.current,
    ...(frame.error !== undefined ? { error: frame.error } : {}),
  }),
  sessions: (frame) => ({ type: 'sessions', items: frame.items }),
  history_earlier: (frame) => ({ type: 'history_earlier', blocks: frame.blocks, total: frame.total }),
  trace: (frame) => ({ type: 'trace', rows: frame.rows, total: frame.total }),
  error: (frame) => ({ type: 'error', message: frame.message }),
};

/**
 * Route one inbound frame.
 * @param frame - a frame from the host, already JSON-parsed and trusted (it
 *   came from the kernel's own serializer, over a same-origin socket).
 * @returns the action to dispatch, or null when this surface ignores the frame.
 */
export function frameAction(frame: ServerFrame): Action | null {
  const mapper = MAPPERS[frame.type] as (inbound: ServerFrame) => Action | null;
  return mapper(frame);
}