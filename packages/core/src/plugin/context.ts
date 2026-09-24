/**
 * The context — what a plugin body receives. It is the only way a plugin
 * reaches a capability (a *service*, addressed by a typed key and declared
 * up front in `inject`) and the only way it registers one (as an effect, so
 * unloading takes it back automatically).
 *
 * Design notes worth keeping:
 *  - Services are addressed by key, not by property magic: `ctx.must(llm)` is
 *    greppable, typed, and fails with the plugin's own name in the message.
 *  - `inject` is a *requirement* list (see `satisfied()`); optional
 *    capabilities use `ctx.get(...)` instead, which keeps the boot check
 *    meaningful.
 *  - Nothing here knows about agents, tools or terminals. The agent loop is a
 *    plugin like any other; this file is the whole framework.
 */
import { EventRegistry, type EventKey, type Listener, type OnOptions, type Logger } from './events.js';
import { Fiber, type Runtime } from './fiber.js';
import { ServiceStore, ServiceUnavailable } from './store.js';
import {
  resolvePlugin,
  type AnyPlugin,
  type Dispose,
  type ServiceKey,
} from './types.js';

export interface ContextInit {
  runtime: Runtime;
  fiber?: Fiber | undefined;
  symbols: Record<string, symbol>;
  root?: Context | undefined;
}

export class Context {
  readonly root: Context;
  readonly runtime: Runtime;
  readonly fiber: Fiber | undefined;
  readonly symbols: Record<string, symbol>;

  private constructor(init: ContextInit) {
    this.runtime = init.runtime;
    this.fiber = init.fiber;
    this.symbols = init.symbols;
    this.root = init.root ?? this;
  }

  /** The top-level assembly context: no owning plugin, permanent registrations. */
  static createRoot(options?: { log?: Logger }): Context {
    const log = options?.log ?? defaultLog;
    const runtime: Runtime = {
      store: new ServiceStore(),
      events: new EventRegistry(log),
      log,
      fibers: new Set(),
    };
    const root = new Context({ runtime, symbols: {}, root: undefined });
    // A provider appearing or disappearing re-points whoever declared it.
    runtime.store.subscribe((name) => {
      // Snapshot the waiters: a reload can dispose fibers, and disposing
      // mutates the set this loop would otherwise be walking.
      const waiters = [...runtime.fibers].filter((fiber) => fiber.state !== 'disposed' && fiber.inject.includes(name));
      for (const fiber of waiters) {
        void fiber.refresh().catch((err: unknown) => {
          log('error', `plugin "${fiber.name}" failed to reload: ${describe(err)}`);
        });
      }
    });
    return root;
  }

  get log(): Logger {
    return this.runtime.log;
  }

  /** Read a service; undefined when no live provider supplies it. */
  get<T>(key: ServiceKey<T> | string): T | undefined {
    const impl = this.runtime.store.resolve(this.symbols, nameOf(key));
    return impl?.value as T | undefined;
  }

  /** Read a required service; a miss names both the service and the reader. */
  must<T>(key: ServiceKey<T> | string): T {
    const name = nameOf(key);
    const impl = this.runtime.store.resolve(this.symbols, name);
    if (impl === undefined) {
      const who = this.fiber === undefined ? 'the assembly' : `plugin "${this.fiber.name}"`;
      throw new ServiceUnavailable(name, who);
    }
    return impl.value as T;
  }

  /** Register a service for as long as the owning plugin lives. */
  provide<T>(key: ServiceKey<T> | string, value: T, check?: () => boolean): Dispose {
    const name = nameOf(key);
    const symbol = this.runtime.store.keyFor(this.symbols, name);
    return this.effect(() => {
      this.runtime.store.register(symbol, {
        name,
        value,
        fiber: this.fiber,
        check,
      });
      return () => this.runtime.store.unregister(symbol);
    }, `provide(${name})`);
  }

  /**
   * Run `body` now and keep its undo. Everything a plugin registers — tools,
   * commands, events, timers, service providers — goes through here.
   */
  effect(body: () => Dispose | readonly Dispose[] | undefined, label = 'effect'): Dispose {
    const fiber = this.fiber;
    if (fiber === undefined) {
      const disposers = normalize(body());
      return () => runReverse(disposers);
    }
    return fiber.addEffect(body, label);
  }

  /**
   * Load a plugin. Returns its fiber; a body that awaits nothing has already
   * activated, and `fiber.ready` settles the attempt either way (rejecting
   * with the plugin's own error).
   */
  plugin<T>(plugin: AnyPlugin | AnyPlugin[], config?: T, name?: string): Fiber {
    const chosen = Array.isArray(plugin) ? plugin[0] : plugin;
    const resolved = resolvePlugin(chosen as AnyPlugin, name ?? 'anonymous');
    const fiber = new Fiber(
      this.runtime,
      resolved,
      this.symbols,
      this.fiber,
      (f) => new Context({ runtime: this.runtime, fiber: f, symbols: this.symbols, root: this.root }),
      config ?? {},
    );
    fiber.start();
    return fiber;
  }

  /** Subscribe to an event for as long as the owning plugin lives. */
  on<Args extends unknown[], Result>(
    key: EventKey<Args, Result> | string,
    listener: Listener<Args, Result>,
    opts?: OnOptions,
  ): Dispose {
    return this.effect(
      () => this.runtime.events.on(key as never, listener as never, opts),
      `on(${nameOf(key)})`,
    );
  }

  emit<Args extends unknown[]>(key: EventKey<Args, void> | string, ...args: Args): void {
    this.runtime.events.emit(key as never, ...args);
  }

  waterfall<Result>(key: EventKey<unknown[], Result> | string, ...args: unknown[]): Promise<Result> {
    return this.runtime.events.waterfall(key as never, ...args) as Promise<Result>;
  }

  parallel(key: EventKey<unknown[], void> | string, ...args: unknown[]): Promise<void> {
    return this.runtime.events.parallel(key as never, ...args);
  }

  serial<Result>(
    key: EventKey<unknown[], Result> | string,
    ...args: unknown[]
  ): Promise<Result | undefined> {
    return this.runtime.events.serial(key as never, ...args) as Promise<Result | undefined>;
  }

  bail<Result>(key: EventKey<unknown[], Result> | string, ...args: unknown[]): Result | undefined {
    return this.runtime.events.bail(key as never, ...args) as Result | undefined;
  }

  /** A child scope where `name` resolves to its own provider (per-agent trees). */
  isolate(name: string): Context {
    const symbols: Record<string, symbol> = Object.create(this.symbols);
    symbols[name] = Symbol(name);
    return new Context({ runtime: this.runtime, fiber: this.fiber, symbols, root: this.root });
  }

  /** Declared services that no live provider supplies — the boot check. */
  unsatisfied(): string[] {
    const missing = new Set<string>();
    for (const fiber of this.runtime.fibers) {
      if (fiber.state === 'disposed') continue;
      for (const name of fiber.inject) {
        if (this.runtime.store.resolve(this.symbols, name) === undefined) missing.add(name);
      }
    }
    return [...missing];
  }

  /** Every live plugin, for diagnostics. */
  roster(): { name: string; state: string; inject: readonly string[] }[] {
    return [...this.runtime.fibers].map((fiber) => ({
      name: fiber.name,
      state: fiber.state,
      inject: fiber.inject,
    }));
  }
}

function nameOf(key: ServiceKey<unknown> | string): string {
  return typeof key === 'string' ? key : key.name;
}

function normalize(value: Dispose | readonly Dispose[] | undefined): Dispose[] {
  if (value === undefined) return [];
  return typeof value === 'function' ? [value] : [...value];
}

async function runReverse(disposers: readonly Dispose[]): Promise<void> {
  for (const dispose of [...disposers].reverse()) {
    try {
      await dispose();
    } catch {
      /* a failing undo must not stop the remaining ones */
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

const defaultLog: Logger = (level, message) => {
  const threshold = process.env.NOVA_LOG === undefined ? LEVELS.warn : thresholdFor(process.env.NOVA_LOG);
  if (LEVELS[level] < threshold) return;
  process.stderr.write(`[nova:${level}] ${message}\n`);
};

function thresholdFor(setting: string): number {
  const level = setting === '1' ? 'info' : setting;
  return level in LEVELS ? LEVELS[level as keyof typeof LEVELS] : LEVELS.warn;
}
