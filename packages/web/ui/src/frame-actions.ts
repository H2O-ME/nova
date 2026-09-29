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
  roster: (frame) => ({ type: 'roster', entries: frame.entries, configPath: frame.configPath }),
  plugins: (frame) => ({ type: 'plugins', entries: frame.entries, disable: frame.disable }),
  skills: (frame) => ({ type: 'skills', items: frame.items, disable: frame.disable }),
  qqbot: (frame) => {
    // The whole frame, not field-by-field: hand-copying a server frame is how its
    // NEW optional fields get silently dropped, and it already happened here —
    // `running` (from `snapshotWithRuntime`) and `error` (the config diagnosis)
    // were both reaching the browser as nothing, which left the page's 运行中
    // branch and its error card as dead code no real session could reach. Same
    // discipline as `launchWeb`'s whole-options pass-through (AGENTS.md §5).
    const { type: _frameType, ...snapshot } = frame;
    return { type: 'qqbot', snapshot };
  },
  qqbot_test: (frame) => ({
    type: 'qqbot_test',
    result: {
      ok: frame.ok,
      ...(frame.gateway !== undefined ? { gateway: frame.gateway } : {}),
      ...(frame.message !== undefined ? { message: frame.message } : {}),
    },
  }),
  model_config: (frame) => ({
    type: 'model_config',
    models: frame.models,
    published: frame.published,
    automatic: frame.automatic,
  }),
  providers: (frame) => ({
    type: 'providers',
    providers: frame.providers,
    ...(frame.activeId !== undefined ? { activeId: frame.activeId } : {}),
  }),
  provider_probe: (frame) => ({
    type: 'provider_probe',
    baseURL: frame.baseURL,
    ok: frame.ok,
    models: frame.models,
    ...(frame.message !== undefined ? { message: frame.message } : {}),
  }),
  sessions: (frame) => ({ type: 'sessions', items: frame.items }),
  files: (frame) => ({ type: 'files', query: frame.query, items: frame.items, truncated: frame.truncated }),
  // The level travels whole: `path`/`crumbs`/`roots`/`parent` are the host's own
  // answer and the dialog draws them directly, so nothing is re-derived here.
  directory: (frame) => ({
    type: 'directory',
    level: {
      path: frame.path,
      home: frame.home,
      ...(frame.parent !== undefined ? { parent: frame.parent } : {}),
      crumbs: frame.crumbs,
      roots: frame.roots,
      entries: frame.entries,
      truncated: frame.truncated,
    },
  }),
  directory_error: (frame) => ({ type: 'directory_error', message: frame.message }),
  history_earlier: (frame) => ({ type: 'history_earlier', blocks: frame.blocks, total: frame.total }),
  trace: (frame) => ({ type: 'trace', rows: frame.rows, total: frame.total }),
  // The terminal frame travels as its payload (minus the discriminant): the
  // slice's fold reads `id`/`status`/`text`/`detail`/`error` whole, and
  // re-listing the fields here is how a new one gets silently dropped.
  terminal: (frame) => {
    const { type: _frameType, ...payload } = frame;
    return { type: 'terminal', frame: payload };
  },
  error: (frame) => ({ type: 'error', message: frame.message }),
};

/**
 * Route one inbound frame.
 *
 * The lookup is guarded with `Object.hasOwn` because the KEY is not trustworthy:
 * `MAPPERS` is an object literal, and the frames this sees are whatever
 * `JSON.parse` produced from the socket (`client.ts`) — nothing validates the
 * discriminant before this point. A frame whose `type` happens to be an
 * inherited member name therefore resolves to `Object.prototype`'s own member
 * instead of `undefined`, and is then CALLED as a mapper: `valueOf` and
 * `hasOwnProperty` throw `TypeError: Cannot convert undefined or null to object`
 * from inside the socket's `onmessage`, and `constructor` returns a bogus action
 * that falls off the reducer's `switch`, leaving state `undefined`. An
 * unrecognized frame must be ignored, not routed.
 * @param frame - a frame from the host, already JSON-parsed (see the guard above).
 * @returns the action to dispatch, or null when this surface ignores the frame.
 */
export function frameAction(frame: ServerFrame): Action | null {
  const type = frame.type;
  if (!Object.hasOwn(MAPPERS, type)) return null;
  const mapper = MAPPERS[type as keyof typeof MAPPERS] as (inbound: ServerFrame) => Action | null;
  return mapper(frame);
}