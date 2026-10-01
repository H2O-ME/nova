/**
 * The context-insight contract: what a session's window is made of, how it got
 * there, and what the run did with it.
 *
 * Shapes live in `core` for the same reason `job-types.ts` and
 * `presentation.ts` do — they are a VOCABULARY two sides speak (the plugin that
 * folds a log, the surfaces that draw the fold), and neither side may own it:
 * a surface that had to import the producer to name its wire would be the
 * second implementation of the contract. Nothing here computes anything; the
 * fold itself is `packages/plugins`'s context plugin.
 *
 * The numbers are ESTIMATES and are labelled as such: `estimateTextTokens`
 * prices text, so a category figure is a composition reading, never a bill.
 * Provider-reported values (`prompt` / `cached` / `output` on a point) ride
 * alongside as the anchor a reader checks the estimate against.
 */
import type { SessionEvent } from './session.js';

/**
 * Which part of the assembled request a unit of context belongs to.
 *
 * `injected` is the seeded session fragment — the environment block, the
 * operator's directives, the AGENTS.md chain, the skills index — and it is one
 * category rather than four because those rows are told apart by their
 * {@link ContextElement.label} (the section tag), exactly as the model sees
 * them. `tool` is a tool RESULT: the call that produced it is what the label
 * names.
 */
export type ContextCategory = 'system' | 'tools' | 'injected' | 'user' | 'assistant' | 'tool';

/** Every category, in the order a reader accounts for a request. */
export const CONTEXT_CATEGORIES: readonly ContextCategory[] = [
  'system',
  'tools',
  'injected',
  'user',
  'assistant',
  'tool',
];

/** Per-category token estimates. Every category is always present (0 when empty). */
export type ContextBreakdown = Record<ContextCategory, number>;

/**
 * A zeroed breakdown — every category present.
 *
 * A record with holes in it would make `cats[cat]` read `undefined` for the
 * categories a request happens not to use, and the ONE place that decides what
 * "no tokens in this category" looks like is here rather than at each reader.
 */
export function emptyBreakdown(): ContextBreakdown {
  return { system: 0, tools: 0, injected: 0, user: 0, assistant: 0, tool: 0 };
}

/**
 * One priced unit of the assembled request.
 *
 * Elements are the OPEN BOX behind a composition bar: the fold keeps one per
 * tool schema, per fragment section and per message, each stamped with the log
 * position it entered at. A point's composition is the elements that had
 * entered before it (see {@link ContextPoint.seq}) and had not been removed by
 * a compaction — so one element list answers every historical request, and the
 * wire stays proportional to the session, not to its requests.
 */
export interface ContextElement {
  /** Log position the element entered at (its message's index in the event stream). */
  seq: number;
  cat: ContextCategory;
  /** What the row is called: a tool name, a section tag, a message's opening words. */
  label: string;
  /** Estimated tokens, framing included. */
  tokens: number;
  /** Opening characters of the content, for a browser row. Absent for schemas. */
  preview?: string;
  /**
   * Log position of the compaction that took it off the surface. A removed
   * element stays in the list (the trend must still be able to explain what a
   * PAST request was made of) but no longer counts toward the live window.
   */
  gone?: number;
  /** `tool` elements only: whether the call it reports failed. */
  ok?: boolean;
}

/** One completed model request — a point on the trend, a row in the history. */
export interface ContextPoint {
  /** Log position of the assistant message the request produced. */
  seq: number;
  at: number;
  /** The window as it stood when the request went out (elements with `seq` below). */
  cats: ContextBreakdown;
  /** Sum of {@link cats} — the estimate this point's bar is drawn from. */
  total: number;
  /** Provider-reported prompt tokens. Absent when the call reported no usage. */
  prompt?: number;
  /** Provider-reported prompt tokens served from cache. */
  cached?: number;
  /** Provider-reported completion tokens. */
  output?: number;
}

/** Why the window changed, in the order a reader asks. */
export type ContextEventKind = 'compaction' | 'workspace' | 'goal';

/** One explainable change to the window. */
export interface ContextEventRecord {
  seq: number;
  at: number;
  kind: ContextEventKind;
  /**
   * Compactions only: net tokens reclaimed, positive. The estimate is
   * `shadowedTokenCount` (what the replaced surface was worth), which is the
   * only figure the log carries.
   */
  freed?: number;
  /** Producer detail: the new workspace path, the goal's opening words. */
  detail?: string;
}

/** One file the session touched, aggregated over every op that named it. */
export interface FileOpRecord {
  path: string;
  reads: number;
  writes: number;
  searches: number;
  /** Lines a write/edit added, when the arguments carry the text (`edit` does). */
  added: number;
  /** Lines a write/edit removed. */
  removed: number;
  /** Last log position that touched it — the sort key a reader wants by default. */
  seq: number;
}

/**
 * The session's context, folded. One object answers all four questions the
 * panel asks (what is in the window now, how it grew, why it changed, what it
 * did to the files), because they are one walk over one log.
 */
export interface ContextTimeline {
  /** A bounded window dropped history: the trend covers the most recent points. */
  truncated: boolean;
  /** Live composition: elements still on the surface, and their estimate. */
  live: {
    cats: ContextBreakdown;
    total: number;
    elements: ContextElement[];
  };
  counts: {
    /** Completed model requests (= points). */
    requests: number;
    /** Distinct user turns. */
    turns: number;
    toolCalls: number;
    compactions: number;
  };
  points: ContextPoint[];
  events: ContextEventRecord[];
  files: FileOpRecord[];
}

/**
 * What the log cannot carry, supplied by whoever holds it: the system prompt
 * and the tool schemas are assembled per request by the kernel, never written
 * to the session file — so a fold that wants to price them has to be TOLD them,
 * and told them again whenever the roster or the code mode changes them.
 */
export interface ContextSurface {
  system?: string;
  tools?: readonly { name: string; description?: string; parameters?: unknown }[];
}

/**
 * A fold in progress over one session's log.
 *
 * Deliberately stateful and mutating: this accumulates over an append-only
 * stream, one event at a time, for as long as a session lives. Handing back a
 * fresh object per event would copy every element list on every tool result for
 * no reader's benefit.
 */
export interface ContextFold {
  /** Fold one appended event (in log order). */
  apply(event: SessionEvent, surface?: ContextSurface): void;
  /** The current reading. Recomputed on call; safe to serialize. */
  view(): ContextTimeline;
}

/** The context-insight capability: open a fold over a log. */
export interface ContextInsights {
  /**
   * Start folding a session's log.
   * @param events - the log so far, in order. A session opened fresh passes none.
   * @param surface - the system prompt + tool schemas in force.
   * @returns a fold the caller advances with each appended event.
   */
  fold(events: readonly SessionEvent[], surface?: ContextSurface): ContextFold;
}
