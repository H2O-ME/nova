/**
 * Browser-side plugin loader: discovers plugins that ship a client bundle and
 * loads each one exactly once per page.
 *
 * The plugin's server half registers its asset prefix through the kernel
 * container (`ctx.must(routes).register({ prefix: '/plugins/<name>', … })`).
 * The boot graph (the `clientBundle` field on each `WireRosterEntry`) tells
 * the loader WHERE the bundle lives; with the HTTP server gone the bytes are
 * fetched over a `plugin_asset` frame, turned into a blob URL, and injected
 * as a `<script>` — after which the loader reads what the bundle registered
 * on `window.__NovaPlugins__`.
 *
 * The contract is intentionally minimal: a client bundle is a script that
 * runs once and registers its contributions (fence renderers, React
 * components, genui factories) by writing to `window.__NovaPlugins__[name]`.
 * The host imports the typed surface from THIS module; the bundle is expected
 * to ship its own (possibly bundled) copy that writes to the same global —
 * the registry underneath is the single source of truth, not any one
 * module's export.
 *
 * Failures are final per entry: a bundle the host cannot produce (the plugin's
 * asset route is not registered, or the frame comes back refused) or that
 * throws on load is reported once and never retried, so a broken plugin
 * cannot wedge the page by failing on every navigation.
 *
 * The DOM-touching part is one tiny function (`injectScript`); everything
 * else is pure and unit-tested without jsdom (the UI test lane is
 * node-only). The separation mirrors the rest of the UI layer: pure helpers
 * + SSR-to-string, with the React tree doing the only DOM touches.
 */
import type { PluginClientBundle } from '@nova-agent/core';
import { requestFrame } from '../client/requests.js';

/** What `Kernel.roster()` (the boot graph) tells the browser about a plugin. */
export interface BootGraphEntry {
  name: string;
  /**
   * Whether the plugin is switched ON — the operator's INTENT, not liveness: a
   * row whose `apply()` threw also reads `true`. See {@link entriesToLoad}.
   */
  enabled?: boolean;
  /**
   * The plugin's container phase (`pending` / `loading` / `active` / `failed` /
   * `disposed`) — the LIVENESS fact. Only `active` proves `apply()` finished,
   * which is when the plugin's asset route exists. Absent on a host that does
   * not report phases; see {@link entriesToLoad}.
   */
  state?: string;
  /** The plugin's client bundle; absent when the plugin is server-only. */
  clientBundle?: PluginClientBundle;
}

/** The shape of what a loaded bundle registers on `window.__NovaPlugins__`. */
export interface ClientPluginContributions {
  /** A namespaced bag of anything the host or other plugins might consume. */
  readonly [key: string]: unknown;
}

/** The global register target bundles write to. */
export const PLUGIN_GLOBAL_KEY = '__NovaPlugins__';

interface NovaPluginsGlobal {
  [PLUGIN_GLOBAL_KEY]?: Record<string, ClientPluginContributions>;
}

type GlobalWithPlugins = typeof globalThis & NovaPluginsGlobal;

/** Read the contributions one bundle registered (pure — reads the global). */
export function readContributions(name: string): ClientPluginContributions | undefined {
  const store = (globalThis as GlobalWithPlugins)[PLUGIN_GLOBAL_KEY];
  if (store === undefined) return undefined;
  return store[name];
}

/** Write contributions to the global (host-bundled plugins + tests). */
export function writeContributions(name: string, contributions: ClientPluginContributions): void {
  if (name.length === 0) return;
  const global = globalThis as GlobalWithPlugins;
  if (global[PLUGIN_GLOBAL_KEY] === undefined) global[PLUGIN_GLOBAL_KEY] = {};
  global[PLUGIN_GLOBAL_KEY]![name] = contributions;
}

/**
 * Build the request path for one plugin's client bundle（PURE — testable
 * without DOM）。
 *
 * 这就是插件自己的资产路由期待的路径（`/plugins/<name>/<file>`），由宿主的
 * `RouteRegistry` 匹配到该插件的 handler——路由逻辑不变，只是字节的目的地
 * 变了。`rev` 不再上路径：缓存破坏是浏览器 script 缓存时代的职责，blob 注入
 * 没有缓存可言。
 */
export function buildBundlePath(name: string, spec: PluginClientBundle): string {
  const file = spec.path ?? 'client.js';
  const trimmed = file.replace(/^\/+/, '');
  return `/plugins/${encodeURIComponent(name)}/${trimmed}`;
}

/**
 * 取回一个插件资源的测试接缝与生产实现同形：路径进、文本出。生产实现走
 * `plugin_asset` 帧（按回帧 path 精确匹配，所以多插件并行加载互不错配）；
 * 测试注入替身绕开这条需要连接的路径。
 */
export type FetchAssetFn = (path: string) => Promise<{ text: string; contentType?: string } | undefined>;

const defaultFetchAsset: FetchAssetFn = async (path) => {
  const reply = await requestFrame({ type: 'plugin_asset', path }, 'plugin_asset', {
    match: (candidate) => candidate.path === path,
  });
  if (reply === undefined || reply.ok !== true || reply.text === undefined) return undefined;
  return {
    text: reply.text,
    ...(reply.contentType !== undefined ? { contentType: reply.contentType } : {}),
  };
};

let fetchAsset: FetchAssetFn = defaultFetchAsset;

/** 替换资源取回器（测试用）；传 `undefined` 恢复默认。 */
export function setAssetFetcher(fn: FetchAssetFn | undefined): void {
  fetchAsset = fn ?? defaultFetchAsset;
}

interface PendingLoad {
  promise: Promise<ClientPluginContributions>;
  resolve: (contributions: ClientPluginContributions) => void;
  reject: (error: Error) => void;
}

const pending = new Map<string, PendingLoad>();
const settled = new Map<string, ClientPluginContributions | Error>();

/**
 * The DOM-touching part, isolated: inject a `<script src=url>` and call back
 * on load/error. The rest of the loader is pure and unit-tested; this is the
 * one function the React boot orchestrator calls that needs `document`.
 *
 * Test override: assign `injectScript` to a fake to bypass DOM interaction —
 * the loader's pure logic is testable this way without standing up jsdom.
 * The hook is intentionally exported (one symbol) so the production caller
 * and the test stand-in share the same call site.
 */
export type InjectScriptFn = (url: string, onLoad: () => void, onError: () => void) => void;

const defaultInject: InjectScriptFn = (url, onLoad, onError) => {
  if (typeof document === 'undefined') {
    onError();
    return;
  }
  const script = document.createElement('script');
  // blob: 与本页同源，不再需要跨域标记（那是从插件 HTTP 路由加载的时代留下的）。
  script.src = url;
  script.async = true;
  script.onload = () => onLoad();
  script.onerror = () => onError();
  document.head.appendChild(script);
};

/** The injection strategy — overridable for tests via {@link setScriptInjector}. */
let injectScript: InjectScriptFn = defaultInject;

/**
 * Replace the script injector (tests only). Pass `undefined` to restore the
 * default (real DOM) injector.
 */
export function setScriptInjector(fn: InjectScriptFn | undefined): void {
  injectScript = fn ?? defaultInject;
}

/**
 * Load one plugin's client bundle and resolve with what it registered.
 *
 * Memoized per `name` for the page: repeat calls (re-render, navigation,
 * boot re-entry) share one script load. A failure is final for the page —
 * the bundle stays in `settled` as an `Error` so callers can report it once
 * rather than hammering a broken route.
 *
 * @param name - the plugin's roster name (the same id `/plugins` shows).
 * @param spec - the bundle's path and rev, from the boot graph.
 */
export function loadClientPlugin(name: string, spec: PluginClientBundle): Promise<ClientPluginContributions> {
  if (name.length === 0) return Promise.reject(new Error('plugin name is empty'));
  const prior = settled.get(name);
  if (prior instanceof Error) return Promise.reject(prior);
  if (prior !== undefined) return Promise.resolve(prior);
  const inflight = pending.get(name);
  if (inflight !== undefined) return inflight.promise;
  const path = buildBundlePath(name, spec);
  let resolver: (contributions: ClientPluginContributions) => void;
  let rejecter: (error: Error) => void;
  const task = new Promise<ClientPluginContributions>((resolve, reject) => {
    resolver = resolve;
    rejecter = reject;
    void fetchAsset(path).then((asset) => {
      if (asset === undefined) {
        const err = new Error(`plugin '${name}' bundle '${path}' failed to load (no route, or host refused)`);
        settled.set(name, err);
        pending.delete(name);
        reject(err);
        return;
      }
      // blob URL 只在真浏览器里被 `<script>` 消费；测试注入器不会碰它，所以
      // 非 DOM 环境（无 createObjectURL）给占位串即可，与 attachments.ts 的
      // 预览 URL 防御同法。
      const url = typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(new Blob([asset.text], { type: asset.contentType ?? 'text/javascript' }))
        : `nova-blob:${path}`;
      injectScript(
        url,
        () => {
          // script 执行完 blob 已被消费，尽早归还内存。
          URL.revokeObjectURL?.(url);
          const contributions = readContributions(name);
          if (contributions === undefined) {
            const err = new Error(
              `plugin '${name}' loaded but registered nothing on window.${PLUGIN_GLOBAL_KEY}['${name}']`,
            );
            settled.set(name, err);
            pending.delete(name);
            reject(err);
            return;
          }
          settled.set(name, contributions);
          pending.delete(name);
          resolve(contributions);
        },
        () => {
          URL.revokeObjectURL?.(url);
          const err = new Error(`plugin '${name}' bundle '${path}' failed to load (script rejected)`);
          settled.set(name, err);
          pending.delete(name);
          reject(err);
        },
      );
    }, () => {
      const err = new Error(`plugin '${name}' bundle '${path}' failed to load (asset fetch failed)`);
      settled.set(name, err);
      pending.delete(name);
      reject(err);
    });
  });
  // Stored BEFORE the injector runs: an injector that resolves synchronously
  // (the test resolver helpers) finds the pending entry by name and can drive
  // resolve/reject even when the production injector would have left it
  // hanging.
  const load: PendingLoad = {
    promise: task,
    resolve: (c) => {
      settled.set(name, c);
      pending.delete(name);
      resolver(c);
    },
    reject: (e) => {
      settled.set(name, e);
      pending.delete(name);
      rejecter(e);
    },
  };
  pending.set(name, load);
  return task;
}

/**
 * Pick the entries the boot graph would load — PURE, unit-tested.
 *
 * Same criterion the settings navigation applies to this roster
 * (`settings/plugin-state.ts`): `enabled !== false` is the operator's intent and
 * `state === 'active'` the liveness fact. A bundle needs liveness — it is served
 * by the plugin's OWN asset route (`/plugins/<name>/*`), registered by that
 * plugin's `apply()`. A WHITELIST, not a `state !== 'failed'` blacklist:
 * `pending` / `loading` have no route yet, `failed` had its effects undone,
 * `disposed` was torn down, an unknown phase proves nothing either — `enabled`
 * alone shipped a bundle for a plugin that threw in `apply()` (its row reads
 * `enabled: true, state: 'failed'`) at a route it cannot serve.
 *
 * A wrong guess is FINAL, not merely wasteful: `loadClientPlugin` never retries
 * a refused bundle, so asking too early kills the bundle for the whole page,
 * while skipping costs nothing — the next roster snapshot walks the graph
 * again. A host that reports no phases sends no `state` at all (the wire
 * always carries it: `WireRosterEntry.state` is required, and `App` hands that
 * roster over), and absent stays FAIL-OPEN like every other optional roster
 * flag (`roster-entry.ts`): a bare boot graph loads as it always did.
 */
export function entriesToLoad(entries: readonly BootGraphEntry[]): readonly BootGraphEntry[] {
  return entries.filter(
    (entry) =>
      entry.enabled !== false &&
      (entry.state === undefined || entry.state === 'active') &&
      entry.clientBundle !== undefined,
  );
}

/**
 * Walk the boot graph and load every plugin that declares a client bundle.
 *
 * Loads happen in parallel; a single broken bundle does not block the others.
 */
export async function loadBootGraph(entries: readonly BootGraphEntry[]): Promise<PluginLoadReport[]> {
  const tasks = entriesToLoad(entries).map(async (entry) => {
    const spec = entry.clientBundle!;
    try {
      const contributions = await loadClientPlugin(entry.name, spec);
      return { name: entry.name, contributions } satisfies PluginLoadReport;
    } catch (err) {
      return { name: entry.name, error: err instanceof Error ? err : new Error(String(err)) } satisfies PluginLoadReport;
    }
  });
  return Promise.all(tasks);
}

/** One plugin's load result — either its contributions, or the error it threw. */
export type PluginLoadReport =
  | { name: string; contributions: ClientPluginContributions }
  | { name: string; error: Error };

/**
 * Register contributions from outside a bundle (host-bundled plugins, or a
 * test faking a bundle load). The boot orchestrator uses this for plugins
 * that ship INSIDE the host bundle and therefore do not need a script load.
 */
export function registerClientPlugin(name: string, contributions: ClientPluginContributions): void {
  if (name.length === 0) return;
  writeContributions(name, contributions);
  settled.set(name, contributions);
  pending.delete(name);
}

/** Resolve one pending load as if its script succeeded (tests only). */
export function resolvePendingLoad(name: string, contributions: ClientPluginContributions): void {
  const load = pending.get(name);
  if (load !== undefined) {
    load.resolve(contributions);
    return;
  }
  writeContributions(name, contributions);
  settled.set(name, contributions);
}

/** Resolve one pending load as if its script failed (tests only). */
export function rejectPendingLoad(name: string, error: Error): void {
  const load = pending.get(name);
  if (load !== undefined) {
    load.reject(error);
    return;
  }
  settled.set(name, error);
}

/** Reset all loader state — tests use this to fake a fresh page. */
export function resetClientLoader(): void {
  pending.clear();
  settled.clear();
  setAssetFetcher(undefined);
  const global = globalThis as GlobalWithPlugins;
  delete global[PLUGIN_GLOBAL_KEY];
}

/** Read the loader's view of one plugin (test/debug helper). */
export function getLoadedPlugin(name: string): ClientPluginContributions | Error | undefined {
  return settled.get(name);
}
