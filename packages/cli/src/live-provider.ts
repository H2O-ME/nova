/**
 * The web surface's LIVE provider: one stable object that stands in for
 * 「which client is in force right now」 and can swap its target underneath.
 *
 * Why a delegate and not "build a new client": everything downstream holds the
 * SAME instance — the kernel's `llm` service, every session handle, the subagent
 * tool's nested provider, the cache-affinity binding. Replacing the object
 * would strand all of them on the previous client while the UI claimed the new
 * one; swapping the delegate's target reaches all of them at once (the same
 * in-place rule `OpenAICompatClient.setEndpoint` already follows, one level up).
 *
 * The second reason is the FIRST-RUN shell. Boot with no endpoint configured
 * installs the refusing placeholder; when the settings page saves the first
 * provider there is no `setEndpoint` to call — there is no client at all. The
 * builder (injected by the shell, which owns the config file and the client
 * factory) is what closes that loop: `retarget` asks the builder for a REAL
 * client built from the just-saved file and installs it, so the first save
 * works without a restart. A target that cannot `setEndpoint` IS the signal
 * that this rebuild is needed.
 */
import type { ChatProvider } from '@nova-agent/core';

/** What a real client offers beyond the ChatProvider interface (structural). */
interface RealClient extends ChatProvider {
  setEndpoint?(endpoint: {
    baseURL: string;
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }): void;
  setSessionId?(sessionId: string | undefined): void;
}

export interface SwitchableProvider extends ChatProvider {
  setEndpoint(endpoint: {
    baseURL: string;
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<void>;
  /** Whether the current target is still the refusing placeholder. */
  isPlaceholder(): boolean;
  /** Swap the target (a client built by the shell's factory). */
  setTarget(next: ChatProvider): void;
  setSessionId(sessionId: string | undefined): void;
}

/**
 * Build the delegate.
 * @param initial - the boot-time target: a real client, or the placeholder.
 * @param build - the shell's "make a real client from the config file" factory;
 *   required only if the initial target can ever be the placeholder.
 */
export function switchableProvider(
  initial: ChatProvider,
  build: () => Promise<ChatProvider>,
): SwitchableProvider {
  let target: RealClient = initial as RealClient;
  let building: Promise<void> | undefined;
  return {
    get model(): string | undefined {
      return target.model;
    },
    async *stream(req) {
      // Yield THROUGH the current target, read per call: a run started against
      // the placeholder picks up a client installed mid-flight on its NEXT call.
      const current = target;
      yield* current.stream(req);
    },
    setTarget(next: ChatProvider): void {
      target = next as RealClient;
    },
    isPlaceholder(): boolean {
      return typeof target.setEndpoint !== 'function';
    },
    async setEndpoint(endpoint): Promise<void> {
      if (typeof target.setEndpoint !== 'function') {
        // Placeholder in force: rebuild from the config file (the caller has
        // already persisted the row this endpoint describes). One rebuild at a
        // time; concurrent switches share the same build.
        building ??= build().then((next) => {
          target = next as RealClient;
        }).finally(() => {
          building = undefined;
        });
        await building;
      }
      target.setEndpoint?.(endpoint);
    },
    setSessionId(sessionId: string | undefined): void {
      target.setSessionId?.(sessionId);
    },
    listModels(timeoutMs?: number): Promise<string[]> {
      if (typeof target.listModels !== 'function') return Promise.resolve([]);
      return target.listModels(timeoutMs);
    },
    setModel(model: string): void {
      target.setModel?.(model);
    },
  };
}
