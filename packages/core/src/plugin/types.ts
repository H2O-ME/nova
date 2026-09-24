/**
 * Plugin vocabulary — the shapes a plugin may take and the config contract it
 * declares. Kept free of any dependency on the rest of the kernel so a plugin
 * author needs only these types.
 */
import type { Context } from './context.js';

/** Anything that can be undone when its owning plugin unloads. */
export type Dispose = () => void | Promise<void>;
export type Awaitable<T> = T | Promise<T>;

/**
 * A tagged service key: the single, greppable name a capability is registered
 * and resolved under, carrying its type in the generic. Plugins declare what
 * they need by listing keys in `inject`, and read them with `ctx.must(key)`.
 */
export interface ServiceKey<T> {
  readonly name: string;
  /** Phantom field — never read, only makes the key invariant in T. */
  readonly __type?: T;
}

/** Declare a service key. The name is the cross-package contract. */
export function key<T>(name: string): ServiceKey<T> {
  return { name };
}

/** The type a declared key resolves to; `string` declarations stay untyped. */
export type ServiceOf<K> = K extends ServiceKey<infer T> ? T : unknown;
export type AnyServiceKey = ServiceKey<never> | ServiceKey<unknown>;

/**
 * Structural Standard-Schema validator (`~standard.validate`). Declared here
 * instead of depending on the spec package so core stays dependency-free; any
 * conforming library (zod, valibot, schemastery) satisfies it.
 */
export interface ConfigSchema<T> {
  readonly '~standard': {
    readonly validate: (value: unknown) => StandardResult<T> | Promise<StandardResult<T>>;
  };
}

export type StandardResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string }> };

export interface PluginBase<T = unknown> {
  /** Human-readable identity; used in logs and dependency errors. */
  name?: string;
  /** Validator applied to the config before the plugin body runs. */
  Config?: ConfigSchema<T>;
  /**
   * Services this plugin reads. Declaring them buys two things: a clear error
   * naming the missing service when one is absent, and an automatic reload
   * when the provider is replaced (so swapping a backend re-points dependents
   * instead of stranding them on a dead reference).
   */
  inject?: readonly (AnyServiceKey | string)[];
}

/** `apply(ctx, config)` object form. */
export interface PluginObject<T = unknown> extends PluginBase<T> {
  apply(ctx: Context, config: T): Awaitable<void>;
}

/** Bare function form (metadata rides on the function's own properties). */
export type PluginFunction<T = unknown> = ((
  ctx: Context,
  config: T,
) => Awaitable<void>) &
  PluginBase<T>;

/** Provider form: the constructor itself is the plugin, `new`ed with (ctx, config). */
export interface PluginConstructor<T = unknown> extends PluginBase<T> {
  new (ctx: Context, config: T): unknown;
}

export type Plugin<T = unknown> =
  | PluginObject<T>
  | PluginFunction<T>
  | PluginConstructor<T>;

export type AnyPlugin = Plugin<never> | Plugin<unknown> | PluginObject<never>;

/** The three shapes reduced to one callable plus its metadata. */
export interface ResolvedPlugin {
  name: string;
  inject: readonly string[];
  config: ConfigSchema<unknown> | undefined;
  run: (ctx: Context, config: unknown) => Awaitable<void>;
}

function isClass(value: unknown): boolean {
  return /^class[\s{]/.test(Function.prototype.toString.call(value));
}

export function resolvePlugin(plugin: AnyPlugin, fallbackName: string): ResolvedPlugin {
  const meta = plugin as PluginBase<unknown>;
  const name = pluginName(plugin, fallbackName);
  const inject = (meta.inject ?? []).map((entry) =>
    typeof entry === 'string' ? entry : entry.name,
  );
  const base = { name, inject, config: meta.Config };
  if (typeof plugin === 'function' && isClass(plugin)) {
    const Ctor = plugin as unknown as new (c: Context, cfg: unknown) => unknown;
    return { ...base, run: (ctx, config) => void new Ctor(ctx, config) };
  }
  if (typeof plugin === 'function') {
    return { ...base, run: plugin as unknown as ResolvedPlugin['run'] };
  }
  if (typeof plugin === 'object' && plugin !== null) {
    const object = plugin as PluginObject<unknown>;
    return { ...base, run: (ctx, config) => object.apply(ctx, config) };
  }
  throw new Error(`plugin "${name}" is not a function, a class, or an object with apply()`);
}

/**
 * A plugin's identity: an explicitly declared name, else the function/class's
 * own name, else the caller's fallback. An empty string is not a name — a bare
 * arrow function has one, and taking it would put nameless plugins in the
 * roster and in every error message.
 */
function pluginName(plugin: AnyPlugin, fallback: string): string {
  const declared = (plugin as PluginBase<unknown>).name;
  if (typeof declared === 'string' && declared !== '') return declared;
  const own = (plugin as { name?: unknown }).name;
  if (typeof own === 'string' && own !== '') return own;
  return fallback;
}
