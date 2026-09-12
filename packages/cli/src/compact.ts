import type { AgentMessage, ChatProvider, ChatRequest, UserMessage } from '@nova-agent/core';
import {
  compactionSummaryMessage,
  estimateMessageTokens,
  newId,
  Session,
  TURN_ABORTED_GUIDANCE,
  COMPACT_SUMMARY_PREFIX,
} from '@nova-agent/core';
import { isContextFragment } from './context.js';

/**
 * Compaction as a durable in-place operation (dsh-style): instead of
 * rebuilding a fresh session file, the SAME session log appends
 * compaction/start → compaction/summary → compaction/end events and the
 * model-visible surface is projected as [context fragment, recent user
 * messages, summary]. Raw history is never rewritten, a crash mid-compaction
 * is detectable (orphaned lock), and resume reconstructs the identical
 * surface through Session.deriveMessages().
 */

/**
 * Structured like codex's compaction prompt (context checkpoint for a
 * successor LLM): progress + decisions, constraints/preferences, next steps,
 * critical data. Word cap kept from the original Nova prompt.
 */
export const COMPACT_ASK = [
  'You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume this task in a fresh session.',
  'Include:',
  '- Current progress and key decisions made',
  '- Important context, constraints, or user preferences',
  '- What remains to be done (clear next steps)',
  '- Any critical data, file paths, or references needed to continue',
  'Be concise, structured, and under 300 words. Output only the summary.',
].join('\n');

/**
 * Char budget for verbatim recent user messages retained after compaction
 * (codex keeps a 20k-token budget; NovaAgent approximates with chars).
 */
export const COMPACT_RECENT_BUDGET_CHARS = 20_000;

/**
 * Structured prompt for an INCREMENTAL update: when the session surface
 * already carries a prior compaction summary, new messages are merged into it
 * (pi-style preserve-and-update) instead of re-summarizing from scratch.
 */
export const COMPACT_UPDATE_ASK = [
  'You are performing an INCREMENTAL CONTEXT CHECKPOINT UPDATE. The previous checkpoint summary is in <previous_summary>; the conversation messages produced since then are in <conversation>.',
  'Update the previous summary with the new information. Rules:',
  '- PRESERVE all existing information from the previous summary',
  '- ADD new progress, decisions, and context',
  '- UPDATE next steps based on what was accomplished',
  '- Preserve exact file paths, function names, and error messages',
  '- Drop items that are no longer relevant',
  'Keep the same structure and stay under 300 words. Output only the updated summary.',
].join('\n');

/**
 * Per-tool-result char cap in the serialized summary input (pi-style): the
 * summarizer does not need full 40KB tool outputs — findings matter more than
 * raw dumps, and the serialized input itself must stay small.
 */
export const SUMMARY_TOOL_RESULT_MAX_CHARS = 2000;

/**
 * Serialize the conversation into a compact human-readable transcript for the
 * summarizer (pi compaction-utils style). Static context fragments, prior
 * summaries and 40KB tool dumps are stripped or capped: the summary model
 * needs decisions and findings, not the full payload.
 */
export function serializeConversationForSummary(messages: AgentMessage[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    if (isContextFragment(msg) || isCompactSummary(msg)) continue;
    if (msg.role === 'user') {
      parts.push(`[User]: ${msg.content}`);
    } else if (msg.role === 'assistant') {
      if (msg.content.length > 0) parts.push(`[Assistant]: ${msg.content}`);
      if (msg.toolCalls !== undefined && msg.toolCalls.length > 0) {
        const calls = msg.toolCalls.map((call) => `${call.name}(${JSON.stringify(call.args)})`).join('; ');
        parts.push(`[Assistant tool calls]: ${calls}`);
      }
    } else if (msg.role === 'tool' && msg.content.length > 0) {
      const content =
        msg.content.length > SUMMARY_TOOL_RESULT_MAX_CHARS
          ? `${msg.content.slice(0, SUMMARY_TOOL_RESULT_MAX_CHARS)}…[截断]`
          : msg.content;
      parts.push(`[Tool ${msg.name}]: ${content}`);
    }
  }
  return parts.join('\n\n');
}

/**
 * Ask the current model to summarize the conversation. The transcript is sent
 * as one serialized user message (not the raw role-played history) so the
 * summarizer request stays small; with `previousSummary` the ask switches to
 * the incremental merge prompt.
 */
export async function compactConversation(
  client: ChatProvider,
  messages: AgentMessage[],
  previousSummary?: string,
  signal?: AbortSignal,
): Promise<string> {
  const ask =
    previousSummary !== undefined
      ? `${COMPACT_UPDATE_ASK}\n\n<previous_summary>\n${previousSummary}\n</previous_summary>`
      : COMPACT_ASK;
  const history = serializeConversationForSummary(messages);
  const askMsg: UserMessage = {
    id: newId('msg'),
    ts: Date.now(),
    role: 'user',
    content: `${ask}\n\n<conversation>\n${history}\n</conversation>`,
  };
  let summary = '';
  const req: ChatRequest = { messages: [askMsg], signal };
  for await (const ev of client.stream(req)) {
    if (ev.type === 'text_delta') summary += ev.text;
    else if (ev.type === 'reset') summary = ''; // retry replays from scratch
  }
  return summary.trim();
}

export function isCompactSummary(msg: AgentMessage): boolean {
  return msg.role === 'user' && msg.content.startsWith(COMPACT_SUMMARY_PREFIX);
}

/**
 * Recent verbatim user messages kept after compaction (codex-style): newest
 * first within the char budget. The budget takes WHOLE messages — the first
 * one that does not fit stops the walk (nothing skipped, nothing partially
 * kept): a truncated copy could not rejoin the log projection verbatim
 * ("model-visible means logged" requires the kept message to BE a logged
 * message), so cut-or-keep is the only shape that preserves the invariant.
 * Context fragments, prior summaries and abort markers never carry over.
 */
export function selectRecentUserMessages(messages: AgentMessage[], budgetChars: number): UserMessage[] {
  const picked: UserMessage[] = [];
  let budget = budgetChars;
  for (let i = messages.length - 1; i >= 0 && budget > 0; i--) {
    const msg = messages[i];
    if (msg === undefined || msg.role !== 'user') continue;
    if (isContextFragment(msg) || isCompactSummary(msg) || msg.content === TURN_ABORTED_GUIDANCE) continue;
    if (msg.content.length > budget) break;
    picked.push(msg);
    budget -= msg.content.length;
  }
  return picked.reverse();
}

export interface CompactSessionOptions {
  client: ChatProvider;
  /** Session log to append the compaction events to (compacted in place). */
  session: Session;
  /** Live model surface (== session.deriveMessages()). */
  messages: AgentMessage[];
  recentBudgetChars?: number;
  /** Who asked for this compaction; recorded on compaction/start. */
  trigger?: 'auto' | 'manual';
  /** Optional abort signal forwarded to the summarizer request. */
  signal?: AbortSignal;
}

export interface CompactedSession {
  /** New projected surface to use as the live message array. */
  surface: AgentMessage[];
  summary: string;
  /** How many recent user messages were carried over verbatim. */
  retained: number;
}

/**
 * Compact the session in place: append the three compaction events (the lock
 * is released LAST so a crash mid-operation leaves a detectable orphan),
 * then return the projected surface. The caller replaces its message array
 * with `surface` and keeps appending to the same session file.
 */
export async function compactSession(opts: CompactSessionOptions): Promise<CompactedSession> {
  const { client, session, messages } = opts;
  await session.appendEvent({ type: 'compaction/start', trigger: opts.trigger ?? 'manual', at: Date.now() });
  try {
    // Incremental mode: a prior summary on the surface turns this compaction
    // into a preserve-and-update merge (the old summary is excluded from the
    // serialized transcript and embedded in the ask instead).
    const previous = messages.find(isCompactSummary)?.content;
    const previousSummary = previous !== undefined ? previous.slice(COMPACT_SUMMARY_PREFIX.length).trimStart() : undefined;
    const summary = await compactConversation(client, messages, previousSummary, opts.signal);
    const body = summary.length > 0 ? summary : '(无摘要可用)';

    // keep references logged messages by index in the FULL message stream.
    const all = session.allMessages();
    const index = new Map(all.map((msg, i) => [msg.id, i] as const));
    const keep: number[] = [];
    const fragment = all.find((msg) => isContextFragment(msg));
    if (fragment !== undefined) {
      const at = index.get(fragment.id);
      if (at !== undefined) keep.push(at);
    }
    const recent = selectRecentUserMessages(messages, opts.recentBudgetChars ?? COMPACT_RECENT_BUDGET_CHARS);
    for (const msg of recent) {
      const at = index.get(msg.id);
      if (at !== undefined) keep.push(at);
    }
    const shadowedTokenCount = messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);

    const at = Date.now();
    const seq = await session.appendEvent({
      type: 'compaction/summary',
      summary: body,
      keep,
      // Ids alongside positions: the projection prefers ids (corruption-tolerant),
      // old readers still understand the positional form.
      keepIds: keep.map((i) => all[i]?.id).filter((id): id is string => id !== undefined),
      shadowedTokenCount,
      at,
    });
    const surface = [
      ...keep.map((i) => all[i]).filter((msg): msg is AgentMessage => msg !== undefined),
      compactionSummaryMessage(body, seq, at),
    ];
    await session.appendEvent({ type: 'compaction/end', at: Date.now() });
    return { surface, summary: body, retained: recent.length };
  } catch (err) {
    // Release the lock with an error marker so the failed attempt is recorded
    // but does not block future compactions.
    await session
      .appendEvent({ type: 'compaction/end', at: Date.now(), error: err instanceof Error ? err.message : String(err) })
      .catch(() => {});
    throw err;
  }
}

/**
 * Dev-mode runtime invariant ("model-visible means logged"): the live surface
 * must equal the log projection. Returns a short description of the first
 * divergence, or undefined when the invariant holds.
 */
export function surfaceDivergence(session: Session, messages: AgentMessage[]): string | undefined {
  const derived = session.deriveMessages();
  if (derived.length !== messages.length) {
    return `surface has ${messages.length} messages but log projects ${derived.length}`;
  }
  for (let i = 0; i < derived.length; i++) {
    const a = derived[i]!;
    const b = messages[i]!;
    if (a.id !== b.id || a.role !== b.role || a.content !== b.content) {
      return `surface[${i}] diverged from log projection (log: ${a.role}#${a.id})`;
    }
  }
  return undefined;
}
