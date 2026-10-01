/**
 * The Context panel's server half: one fold per session, kept in step with the
 * durable log, and the reading a frame hands to the browser.
 *
 * Driven by the LOG, not by the live event stream. The two vocabularies differ
 * (`KernelEvent` is the live protocol, `SessionEvent` is what the file holds),
 * and more importantly a fold that listened to the stream could drift from what
 * a resume would reconstruct. Reading `session.events` — the in-memory mirror
 * the append path updates — makes the panel and a reopened session the same
 * walk over the same array, and needs no translation table between them.
 *
 * Its own object for the same reason `SessionPages` is: it owns a cursor and a
 * bound session, and the controller would otherwise carry two fields that can
 * disagree about which session is being read.
 *
 * Availability IS the switch. The `context` plugin provides the service at the
 * `advanced` tier; when it is not there this object holds nothing, `reading()`
 * answers undefined, and the frame that clears the panel goes out — so a
 * settings switch and the data cannot disagree about whether the feature is on.
 */
import {
  contextInsights as contextInsightsKey,
  type AgentSession,
  type ContextFold,
  type ContextInsights,
  type ContextSurface,
  type ContextTimeline,
} from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import type { ServerFrame } from './protocol.js';

export class ContextFollow {
  private service: ContextInsights | undefined;
  private bound: AgentSession | undefined;
  private fold: ContextFold | undefined;
  /** Events of `bound` already folded. */
  private cursor = 0;
  private cachedSurface: ContextSurface | undefined;

  /** Whether the plugin in force provides a reading at all. */
  available(kernel: Kernel): boolean {
    return kernel.host.context.get(contextInsightsKey) !== undefined;
  }

  /**
   * Bring the fold up to the log's head, opening it when the plugin appeared or
   * the session changed. Cheap when nothing happened (one length compare).
   */
  private sync(session: AgentSession, kernel: Kernel): ContextFold | undefined {
    const service = kernel.host.context.get(contextInsightsKey);
    if (service === undefined) {
      this.forget();
      return undefined;
    }
    if (this.fold === undefined || this.service !== service || this.bound !== session) {
      this.service = service;
      this.bound = session;
      // Opened over the WHOLE log, not over the events since some cursor: a
      // plugin switched on mid-session must read the session, not the moment it
      // was switched on. The durable Session's event array (not the kernel's
      // live pump) is what a resume rebuilds from — see `Session.events`.
      this.fold = service.fold(session.session.events, this.surfaceOf(kernel));
      this.cursor = session.session.events.length;
      return this.fold;
    }
    const events = session.session.events;
    while (this.cursor < events.length) {
      this.fold.apply(events[this.cursor]!, this.surfaceOf(kernel));
      this.cursor += 1;
    }
    return this.fold;
  }

  /**
   * The reading for the session in force, or undefined when the plugin is off.
   *
   * Opens the fold on first use: `ready` and the panel's own frame are the two
   * moments a reading is wanted, and both are this call.
   */
  reading(session: AgentSession, kernel: Kernel): ContextTimeline | undefined {
    return this.sync(session, kernel)?.view();
  }

  /** The frame that states the reading, `null` when there is none to state. */
  frame(session: AgentSession, kernel: Kernel): ServerFrame {
    return { type: 'context', timeline: this.reading(session, kernel) ?? null };
  }

  /**
   * The system prompt and tool schemas in force.
   *
   * Held by identity because both sources are stable between rebuilds
   * (`PluginHost.tools` is deliberately the same array, the prompt the same
   * string), which is what lets the fold's change check be one comparison
   * instead of a re-pricing of every schema on every event.
   */
  private surfaceOf(kernel: Kernel): ContextSurface {
    const system = kernel.systemPrompt;
    const tools = kernel.host.tools;
    const cached = this.cachedSurface;
    if (cached !== undefined && cached.system === system && cached.tools === tools) return cached;
    const next: ContextSurface = { system, tools };
    this.cachedSurface = next;
    return next;
  }

  private forget(): void {
    this.fold = undefined;
    this.service = undefined;
    this.bound = undefined;
    this.cursor = 0;
  }
}
