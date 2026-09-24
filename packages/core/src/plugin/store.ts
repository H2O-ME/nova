/**
 * Service registry — one map of live implementations, keyed by a symbol that
 * scope isolation can fork. Registration and removal both notify the fibers
 * that declared the name, which is what turns "swap the provider" into
 * "dependents reload" without any boot-order bookkeeping.
 */
import type { Fiber } from './fiber.js';

export interface ServiceImpl {
  name: string;
  value: unknown;
  /** The fiber that provided it; undefined for values registered by the root. */
  fiber: Fiber | undefined;
  /** Availability predicate: a false/throwing check reads as "not ready". */
  check: (() => boolean) | undefined;
}

export class ServiceStore {
  private readonly impls = new Map<symbol, ServiceImpl>();
  /** Root symbol per service name (the key used when no scope isolates it). */
  private readonly globals = new Map<string, symbol>();
  private readonly listeners = new Set<(name: string) => void>();

  /** The store key for `name` in a given isolate scope. */
  keyFor(symbols: Record<string, symbol>, name: string): symbol {
    const isolated = symbols[name];
    if (isolated !== undefined) return isolated;
    let global = this.globals.get(name);
    if (global === undefined) {
      global = Symbol(name);
      this.globals.set(name, global);
    }
    return global;
  }

  register(key: symbol, impl: ServiceImpl): void {
    const existing = this.impls.get(key);
    if (existing !== undefined) {
      throw new Error(
        `service "${impl.name}" is already provided by ${describe(existing.fiber)}`,
      );
    }
    this.impls.set(key, impl);
    this.notify(impl.name);
  }

  unregister(key: symbol): void {
    const impl = this.impls.get(key);
    if (impl === undefined) return;
    this.impls.delete(key);
    this.notify(impl.name);
  }

  /** The live implementation, or undefined when absent or not available. */
  resolve(symbols: Record<string, symbol>, name: string): ServiceImpl | undefined {
    const impl = this.impls.get(this.keyFor(symbols, name));
    if (impl === undefined) return undefined;
    if (impl.check !== undefined) {
      try {
        if (!impl.check()) return undefined;
      } catch {
        return undefined;
      }
    }
    return impl;
  }

  /** Provider identity for one name — the epoch component of dependents. */
  providerOf(symbols: Record<string, symbol>, name: string): ServiceImpl | undefined {
    return this.impls.get(this.keyFor(symbols, name));
  }

  /** Subscribe to register/unregister churn (dependents refresh through this). */
  subscribe(listener: (name: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(name: string): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(name);
      } catch {
        // A broken dependent must not stop the others from refreshing.
      }
    }
  }
}

function describe(fiber: Fiber | undefined): string {
  return fiber === undefined ? 'the root scope' : `plugin "${fiber.name}"`;
}

/** Raised when a plugin reads a service that no live provider supplies. */
export class ServiceUnavailable extends Error {
  constructor(
    readonly service: string,
    readonly requester?: string,
  ) {
    super(
      `service "${service}" is not available — no provider is loaded` +
        (requester === undefined ? '' : ` (required by ${requester})`),
    );
    this.name = 'ServiceUnavailable';
  }
}
