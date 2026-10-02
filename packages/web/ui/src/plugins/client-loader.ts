/**
 * Browser-side plugin loader: discovers plugins that ship a client bundle and
 * loads each one exactly once per page.
 *
 * The plugin's server half registers its asset prefix through the kernel
 * container (`ctx.must(routes).register({ prefix: '/plugins/<name>', … })`),
 * and the SAME prefix serves its browser bundle at `/plugins/<name>/<path>`.
 * The boot graph (the `clientBundle` field on each `WireRosterEntry`) tells
 * the loader WHERE the bundle is and WHAT rev to bust on; the loader injects
 * a `<script>` tag and reads what the bundle registered on
 * `window.__NovaPlugins__` when it loaded.
 *
 * The contract is intentionally minimal: a client bundle is a script that
 * runs once and registers its contributions (fence renderers, React
 * components, genui factories) by writing to `window.__NovaPlugins__[name]`.
 * The host imports the typed surface from THIS module; the bundle is expected
 * to ship its own (possibly bundled) copy that writes to the same global —
 * the registry underneath is the single source of truth, not any one
 * module's export.
 *
 * Failures are final per entry: a bundle that 404s (the plugin's asset route
 * is not registered) or that throws on load is reported once and never
 * retried, so a broken plugin cannot wedge the page by failing on every
 * navigation.
 *
 * The DOM-touching part is one tiny function (`injectScript`); everything
 * else is pure and unit-tested without jsdom (the UI test lane is
 * node-only). The separation mirrors the rest of the UI layer: pure helpers
 * + SSR-to-string, with the React tree doing the only DOM touches.
 */

/** One boot-graph entry: where the bundle is and what rev to bust. */
export interface ClientBundleSpec {
  /** Path under `/plugins/<name>/`; defaults to `client.js`. */
  path?: string;
  /** Content rev (hash or version) appended as `?rev=` for cache busting. */
  rev?: string;
}

/** What `Kernel.roster()` (the boot graph) tells the browser about a plugin. */
export interface BootGraphEntry {
  name: string;
  /** Whether the plugin is currently loaded — only loaded plugins ship bundles. */
  enabled?: boolean;
  /** The plugin's client bundle; absent when the plugin is server-only. */
  clientBundle?: ClientBundleSpec;
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
 * Build the URL for one plugin's client bundle (PURE — testable without DOM).
 *
 * The host's `RouteRegistry` serves `/plugins/<name>/...` from whatever
 * handler the plugin registered; the loader just needs to point at it.
 * `rev` busts the page's script cache (the SAME url is memoized for the page
 * — different rev = different url).
 */
export function buildBundleUrl(name: string, spec: ClientBundleSpec): string {
  const file = spec.path ?? 'client.js';
  const trimmed = file.replace(/^\/+/, '');
  const base = `/plugins/${encodeURIComponent(name)}/${trimmed}`;
  return spec.rev === undefined || spec.rev.length === 0 ? base : `${base}?rev=${encodeURIComponent(spec.rev)}`;
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
  script.src = url;
  script.async = true;
  script.crossOrigin = 'anonymous';
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
export function loadClientPlugin(name: string, spec: ClientBundleSpec): Promise<ClientPluginContributions> {
  if (name.length === 0) return Promise.reject(new Error('plugin name is empty'));
  const prior = settled.get(name);
  if (prior instanceof Error) return Promise.reject(prior);
  if (prior !== undefined) return Promise.resolve(prior);
  const inflight = pending.get(name);
  if (inflight !== undefined) return inflight.promise;
  const url = buildBundleUrl(name, spec);
  let resolver: (contributions: ClientPluginContributions) => void;
  let rejecter: (error: Error) => void;
  const task = new Promise<ClientPluginContributions>((resolve, reject) => {
    resolver = resolve;
    rejecter = reject;
    injectScript(
      url,
      () => {
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
        const err = new Error(`plugin '${name}' bundle '${url}' failed to load (route missing or 404)`);
        settled.set(name, err);
        pending.delete(name);
        reject(err);
      },
    );
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

/** Pick the entries the boot graph would load — PURE, unit-tested. */
export function entriesToLoad(entries: readonly BootGraphEntry[]): readonly BootGraphEntry[] {
  return entries.filter((entry) => entry.enabled !== false && entry.clientBundle !== undefined);
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
  const global = globalThis as GlobalWithPlugins;
  delete global[PLUGIN_GLOBAL_KEY];
}

/** Read the loader's view of one plugin (test/debug helper). */
export function getLoadedPlugin(name: string): ClientPluginContributions | Error | undefined {
  return settled.get(name);
}
