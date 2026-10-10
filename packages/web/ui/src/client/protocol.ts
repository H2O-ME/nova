/**
 * Server frame → reducer action: the browser's ONE routing table. It lives
 * apart from the socket (`client/connection.ts`) because the socket is untestable here and
 * this table is pure — and because the table is where a new frame gets
 * forgotten. The `Mapper` record type makes that a compile error: every variant
 * of `ServerFrame` must have an entry, so a frame the host learned to send
 * cannot be silently dropped by a client that never learned to read it (which
 * is exactly how the trace view's first live run showed an empty log).
 *
 * `null` is a frame this surface deliberately does not act on; sneaking one in
 * as `null` is a decision, not an omission.
 */
import type { Action } from '../state.js';
import type { ServerFrame } from '../types.js';

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
  plugin_response: (frame) => ({
    type: 'plugin_answer',
    plugin: frame.plugin,
    id: frame.id,
    op: frame.op,
    ok: frame.ok,
    // The result travels UNTOUCHED: the host does not interpret a plugin's
    // answer and neither does the browser — the page that asked renders it.
    // Hand-copying fields here is how a plugin's new field gets silently dropped.
    ...(frame.result !== undefined ? { result: frame.result } : {}),
    ...(frame.error !== undefined ? { error: frame.error } : {}),
  }),
  model_config: (frame) => ({
    type: 'model_config',
    models: frame.models,
    published: frame.published,
    automatic: frame.automatic,
    titleModel: frame.titleModel,
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
  // The native-dialog answer travels whole (path / error are independently
  // optional; neither present means the dialog was dismissed).
  picked: (frame) => {
    const { type: _frameType, ...reply } = frame;
    return { type: 'picked', ...reply };
  },
  history_earlier: (frame) => ({ type: 'history_earlier', blocks: frame.blocks, total: frame.total }),
  trace: (frame) => ({ type: 'trace', rows: frame.rows, total: frame.total }),
  context: (frame) => ({ type: 'context', timeline: frame.timeline }),
  // The editor family: a read's two answers, a save's acknowledgement, and a
  // structural change (which re-lists one directory rather than patching it).
  entry: (frame) => ({
    type: 'entry',
    path: frame.path,
    text: frame.text,
    bytes: frame.bytes,
    truncated: frame.truncated,
    binary: frame.binary,
  }),
  entry_error: (frame) => ({ type: 'entry_error', path: frame.path, message: frame.message }),
  entry_changed: (frame) => ({ type: 'entry_changed', change: frame.change, path: frame.path, dir: frame.dir }),
  git_status: (frame) => ({
    type: 'git_status',
    repo: frame.repo,
    branch: frame.branch,
    entries: frame.entries,
    ...(frame.message !== undefined ? { message: frame.message } : {}),
  }),
  git_diff: (frame) => ({
    type: 'git_diff',
    path: frame.path,
    staged: frame.staged,
    text: frame.text,
    truncated: frame.truncated,
    untracked: frame.untracked,
  }),
  git_log: (frame) => ({ type: 'git_log', entries: frame.entries }),
  jobs: (frame) => ({ type: 'jobs', items: frame.items }),
  // The term frame travels as its payload (minus the discriminant): the
  // slice's fold reads `data`/`reset`/`status`/`exitCode`/`error` whole, and
  // re-listing the fields here is how a new one gets silently dropped.
  term: (frame) => {
    const { type: _frameType, ...payload } = frame;
    return { type: 'term', frame: payload };
  },
  // The host's shell inventory travels whole: the menu draws the rows as given
  // and `current` is the one a choiceless terminal starts on — re-listing the
  // fields here is how a new one gets silently dropped.
  shells: (frame) => {
    const { type: _frameType, ...payload } = frame;
    return { type: 'shells', frame: payload };
  },
  error: (frame) => ({ type: 'error', message: frame.message }),
};

/**
 * Route one inbound frame.
 *
 * The lookup is guarded with `Object.hasOwn` because the KEY is not trustworthy:
 * `MAPPERS` is an object literal, and the frames this sees are whatever
 * `JSON.parse` produced from the socket (`client/connection.ts`) — nothing validates the
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