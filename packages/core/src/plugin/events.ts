/**
 * Typed events, with the dispatch mode as part of the event's contract.
 *
 * A listener is registered the same way whatever the mode; what differs is how
 * the emitter delivers. Naming the mode in the call site keeps the classic
 * plugin-system bug out — a policy plugin that silently swallows a chain —
 * because "observe" and "wrap" are visibly different calls.
 *
 *   emit       observe; nobody's return value matters, errors are contained
 *   waterfall  wrap or veto; `next()` delegates, returning without it wins
 *   parallel   fan out and wait for all; failures aggregate
 *   serial     first non-empty answer wins, in order
 *   bail       `serial` without the awaiting (for sync predicates)
 */
import type { Awaitable } from './types.js';

export interface EventKey<Args extends unknown[] = unknown[], Result = void> {
  readonly name: string;
  readonly __args?: Args;
  readonly __result?: Result;
}

export function event<Args extends unknown[] = unknown[], Result = void>(
  name: string,
): EventKey<Args, Result> {
  return { name };
}

/** Registered listener shape: plain listeners simply ignore the trailing `next`. */
export type Listener<Args extends unknown[], Result> = (
  ...args: [...Args, next: () => Promise<Result>]
) => unknown;

export interface OnOptions {
  /** Run before listeners of equal priority. */
  prepend?: boolean;
  /** Higher runs first; default 0. */
  priority?: number;
}

/** A non-empty answer from a `serial`/`bail` chain stops it. */
export function isBailed(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

interface Entry {
  listener: (...args: unknown[]) => unknown;
  priority: number;
  seq: number;
}

export type Logger = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;

export class EventRegistry {
  private readonly entries = new Map<string, Entry[]>();
  private seq = 0;

  constructor(private readonly log: Logger) {}

  on(
    key: EventKey<never[], unknown> | string,
    listener: (...args: unknown[]) => unknown,
    opts?: OnOptions,
  ): () => void {
    const name = typeof key === 'string' ? key : key.name;
    const list = this.entries.get(name) ?? [];
    const entry: Entry = {
      listener,
      priority: opts?.priority ?? 0,
      seq: opts?.prepend === true ? -(this.seq++) : this.seq++,
    };
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    this.entries.set(name, list);
    return () => {
      const current = this.entries.get(name);
      if (current === undefined) return;
      const index = current.indexOf(entry);
      if (index >= 0) current.splice(index, 1);
    };
  }

  private listOf(key: EventKey<never[], unknown> | string): Entry[] {
    return this.entries.get(typeof key === 'string' ? key : key.name) ?? [];
  }

  /** Observe: every listener runs, in order; a throwing listener is contained. */
  emit(key: EventKey<never[], unknown> | string, ...args: unknown[]): void {
    for (const entry of this.listOf(key)) {
      try {
        entry.listener(...args, noop);
      } catch (err) {
        this.log('error', `listener for "${name(key)}" threw: ${message(err)}`);
      }
    }
  }

  /**
   * Wrap: each listener may rewrite the arguments or veto by returning without
   * delegating. A listener's own returned value wins (that is what makes a
   * wrapper a wrapper — `a(b(x))`, not `b(x)`); a listener that returns
   * `undefined` either passes the delegation's answer through, or, if it never
   * delegated, declines the request by ending the chain with `undefined`.
   *
   * `next(...args)` delegates — optionally with rewritten arguments, which is
   * how a plain transformer composes without re-implementing the chain:
   * `async (req, next) => next({ ...req, systemPrompt: hardened })`.
   */
  async waterfall<Result>(key: EventKey<never[], Result> | string, ...args: unknown[]): Promise<Result> {
    const list = this.listOf(key);
    const step = async (index: number, input: unknown[]): Promise<Result> => {
      const entry = list[index];
      if (entry === undefined) return undefined as Result;
      let delegation: Promise<Result> | undefined;
      const next = (replacement?: unknown[]): Promise<Result> =>
        (delegation ??= step(index + 1, replacement ?? input));
      const out = (await entry.listener(...input, next as () => Promise<unknown>)) as Result;
      if (out !== undefined) return out;
      return delegation === undefined ? (undefined as Result) : await delegation;
    };
    return step(0, args);
  }

  /** Fan out: all listeners run concurrently; failures aggregate after all settle. */
  async parallel(key: EventKey<never[], unknown> | string, ...args: unknown[]): Promise<void> {
    const results = await Promise.allSettled(
      this.listOf(key).map((entry) => entry.listener(...args, noop)),
    );
    const failures = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason as unknown);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, `"${name(key)}" listeners failed`);
  }

  /** First non-empty answer wins, in order. */
  async serial<Result>(
    key: EventKey<never[], Result> | string,
    ...args: unknown[]
  ): Promise<Result | undefined> {
    for (const entry of this.listOf(key)) {
      const out = (await entry.listener(...args, noop)) as Result;
      if (isBailed(out)) return out;
    }
    return undefined;
  }

  /** `serial` for synchronous predicates — no awaiting, same first-wins rule. */
  bail<Result>(key: EventKey<never[], Result> | string, ...args: unknown[]): Result | undefined {
    for (const entry of this.listOf(key)) {
      const out = entry.listener(...args, noop) as Result;
      if (isBailed(out)) return out;
    }
    return undefined;
  }

  /** Registered names (diagnostics and tests). */
  names(): string[] {
    return [...this.entries.keys()];
  }
}

function noop(): Promise<never> {
  return Promise.resolve(undefined as never);
}

function name(key: EventKey<never[], unknown> | string): string {
  return typeof key === 'string' ? key : key.name;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Convenience wrapper so callers can await a listener's result uniformly. */
export type Next<Result> = () => Promise<Result>;
export type { Awaitable };
