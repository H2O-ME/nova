/**
 * Fibers — one live plugin instance and everything it registered.
 *
 * A fiber is the unit of activation and teardown. Every registration a plugin
 * makes goes through `ctx.effect(...)`, so unloading is correct by
 * construction rather than by discipline: there is no registry a plugin can
 * forget to clean up. Reloading is driven by the *identity of the providers*
 * a plugin declared in `inject`, so replacing a backend re-points its
 * dependents instead of stranding them on a dead reference.
 *
 * A fiber is deliberately **not** a thenable: awaiting a fiber would have to
 * resolve with the fiber itself, and a thenable that resolves with itself
 * recurses forever instead of settling. Activation is awaited through
 * `fiber.ready`, and the synchronous case (the usual one — a plugin body that
 * returns nothing) is already settled by the time `ctx.plugin()` returns.
 */
import type { Context } from './context.js';
import type { Logger } from './events.js';
import type { ServiceStore } from './store.js';
import type { Dispose, ResolvedPlugin } from './types.js';

export type FiberState = 'pending' | 'loading' | 'active' | 'failed' | 'disposed';

/** What every fiber reaches back into: the shared store, events and log. */
export interface Runtime {
  readonly store: ServiceStore;
  readonly events: import('./events.js').EventRegistry;
  readonly log: Logger;
  /** Every live fiber — the roster the store notifies on provider churn. */
  readonly fibers: Set<Fiber>;
}

type ContextFactory = (fiber: Fiber) => Context;

interface EffectRecord {
  label: string;
  dispose: () => Promise<void>;
}

let nextUid = 1;

export class Fiber {
  readonly uid = nextUid++;
  readonly ctx: Context;
  readonly children = new Set<Fiber>();
  state: FiberState = 'pending';
  error: unknown;
  /** The validated config handed to the plugin body. */
  config: unknown;
  /** Settles with the current activation attempt; already settled when sync. */
  ready: Promise<void> = Promise.resolve();

  private readonly effects: EffectRecord[] = [];
  private epoch: string | undefined;

  constructor(
    readonly runtime: Runtime,
    readonly resolved: ResolvedPlugin,
    readonly symbols: Record<string, symbol>,
    readonly parent: Fiber | undefined,
    makeContext: ContextFactory,
    private readonly raw: unknown = {},
  ) {
    this.ctx = makeContext(this);
    this.parent?.children.add(this);
    runtime.fibers.add(this);
  }

  get name(): string {
    return this.resolved.name;
  }

  /** Services this plugin declared as required. */
  get inject(): readonly string[] {
    return this.resolved.inject;
  }

  /** Register a disposable: `body()` runs now and returns its own undo. */
  addEffect(body: () => Dispose | readonly Dispose[] | undefined, label: string): Dispose {
    if (this.state === 'disposed') {
      throw new Error(`plugin "${this.name}" tried to register "${label}" while disposed`);
    }
    const disposers = normalize(body());
    const record: EffectRecord = { label, dispose: () => runReverse(disposers) };
    this.effects.push(record);
    return () => {
      const index = this.effects.indexOf(record);
      if (index >= 0) this.effects.splice(index, 1);
      return runReverse(disposers);
    };
  }

  /**
   * Activate now (synchronously when the plugin body does not await anything)
   * and remember the attempt. `ready` is the awaitable form.
   */
  start(): Promise<void> {
    const attempt = this.refresh();
    this.ready = attempt;
    // Nobody may be awaiting; a rejection must still be observable.
    attempt.catch(() => undefined);
    return attempt;
  }

  /**
   * Bring the fiber up — or back up after a provider swap. A missing declared
   * service does not silently skip the plugin: the body still runs, and the
   * first access to the absent service raises a named error, so a mis-wired
   * roster fails at boot instead of at the first tool call.
   */
  refresh(): Promise<void> {
    if (this.state === 'disposed' || this.state === 'loading') return this.ready;
    const epoch = this.currentEpoch();
    if (this.state === 'active' && epoch === this.epoch) return Promise.resolve();
    const previous = this.state === 'active' ? this.teardown() : undefined;
    if (previous === undefined) return this.load(epoch);
    return previous.then(
      () => this.load(epoch),
      () => this.load(epoch),
    );
  }

  /** Dispose every registration, newest first. Children go first. */
  async teardown(): Promise<void> {
    for (const child of [...this.children].reverse()) await child.dispose();
    this.children.clear();
    await runReverse(this.effects.map((record) => record.dispose));
    this.effects.length = 0;
    this.epoch = undefined;
  }

  async dispose(): Promise<void> {
    if (this.state === 'disposed') return;
    this.state = 'disposed';
    await this.teardown();
    this.parent?.children.delete(this);
    this.runtime.fibers.delete(this);
  }

  /**
   * Run the plugin body. Synchronous bodies (the common case) leave the fiber
   * `active` before this returns; only an async config schema or an async body
   * defers to a promise.
   */
  private load(epoch: string): Promise<void> {
    this.state = 'loading';
    const schema = this.resolved.config?.['~standard'];
    if (schema === undefined) return this.runBody(epoch, this.raw);
    let outcome: unknown;
    try {
      outcome = schema.validate(this.raw);
    } catch (err) {
      return this.fail(err);
    }
    if (isThenable(outcome)) {
      return Promise.resolve(outcome).then(
        (settled) => this.runBody(epoch, checked(this.name, settled)),
        (err: unknown) => this.fail(err),
      );
    }
    let config: unknown;
    try {
      config = checked(this.name, outcome);
    } catch (err) {
      return this.fail(err);
    }
    return this.runBody(epoch, config);
  }

  private runBody(epoch: string, config: unknown): Promise<void> {
    try {
      const result = this.resolved.run(this.ctx, config);
      if (isThenable(result)) {
        return Promise.resolve(result).then(
          () => {
            this.finish(epoch, config);
          },
          (err: unknown) => this.fail(err),
        );
      }
    } catch (err) {
      return this.fail(err);
    }
    this.finish(epoch, config);
    return Promise.resolve();
  }

  private finish(epoch: string, config?: unknown): void {
    this.config = config;
    this.epoch = epoch;
    this.error = undefined;
    this.state = 'active';
  }

  /**
   * Undo whatever half-registered before the failure — a failed plugin must
   * leave no trace, since a partially registered tool set is worse than none.
   */
  private fail(err: unknown): Promise<never> {
    this.error = err;
    return this.teardown().then(
      () => {
        this.state = 'failed';
        throw err;
      },
      () => {
        this.state = 'failed';
        throw err;
      },
    );
  }

  /** The provider-identity fingerprint used to notice a backend swap. */
  private currentEpoch(): string {
    return this.inject
      .map((name) => {
        const impl = this.runtime.store.providerOf(this.symbols, name);
        return `${name}@${impl?.fiber?.uid ?? 0}`;
      })
      .join('|');
  }
}

function checked(name: string, outcome: unknown): unknown {
  const result = outcome as { value?: unknown; issues?: { message: string }[] };
  if (result.issues !== undefined && result.issues.length > 0) {
    const detail = result.issues.map((issue) => issue.message).join('; ');
    throw new Error(`invalid config for plugin "${name}": ${detail}`);
  }
  return result.value;
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
      // A failing undo must not stop the remaining ones.
    }
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | undefined)?.then === 'function';
}