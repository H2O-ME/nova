/**
 * The session↔hook boundary: the two lifecycle moments where a session calls
 * out to hooks before it does its own work.
 *
 * Extracted from `AgentSession` because these are ADAPTERS, not session logic:
 * they translate between the session's state (the message log, the context
 * fragment convention) and the hook verdicts, and the session itself only needs
 * to know "run this at that moment". Keeping them here is what keeps
 * `session.ts` about one thing (log + run bookkeeping) while the hook surfaces
 * grow.
 *
 * Both functions are deliberately tolerant: a hook that throws must not stop a
 * run, so each reports through a caller-supplied sink and returns "nothing
 * happened" — the fail-open end, which is what makes a hook an add-on.
 */
import { newId } from '../ids.js';
import { isContextFragment } from '../context-fragment.js';
import { errMessage } from '../errors.js';
import type { AgentMessage, SessionStartOutcome, UserMessage } from '../types.js';

/** What the session must supply: its log, its live array, and where to report. */
export interface SessionHookPorts {
  /** The durable log's append (the ONLY write path). */
  append(message: UserMessage): Promise<void>;
  /** Live model surface, owned by the session and spliced in place. */
  messages: AgentMessage[];
  /** Operator-facing notice sink (a thrown hook is reported, never fatal). */
  notice(code: 'hook_failed', text: string): void;
}

/**
 * Append a hook's contributed text as a CONTEXT FRAGMENT.
 *
 * The `msg_ctx_` id prefix is what `isContextFragment` reads, so the text is
 * excluded from "the operator said this" — it rides the first request's prefix
 * as environment, does not count as the opening prompt, and a resumed
 * transcript does not confuse it with a real instruction.
 */
export async function appendHookContext(
  ports: SessionHookPorts,
  text: string,
): Promise<void> {
  if (text.length === 0) return;
  const fragment: UserMessage = { id: newId('msg_ctx'), ts: Date.now(), role: 'user', content: text };
  await ports.append(fragment).catch(() => undefined);
  ports.messages.push(fragment);
}

/**
 * Whether this session is starting fresh or resuming.
 *
 * Derived from the LOG, never from a flag a surface could forget to set: a
 * conversation that already carries a real user message (not a context
 * fragment) is a resume, and one that does not is a startup. That is the same
 * rule the opening-prompt detection uses, so the two cannot disagree.
 */
export function sessionStartSource(messages: readonly AgentMessage[]): 'startup' | 'resume' {
  return messages.some((m) => m.role === 'user' && !isContextFragment(m)) ? 'resume' : 'startup';
}

/**
 * Run the `sessionStart` chain and land its context.
 *
 * A throwing hook is reported and its contribution dropped: the run proceeds,
 * because a broken observer is not a reason to refuse the conversation.
 * @returns nothing — the caller only needs the side effect.
 */
export async function runSessionStartHook(
  ports: SessionHookPorts,
  start: () => Promise<SessionStartOutcome | void | undefined>,
): Promise<void> {
  let outcome: SessionStartOutcome | undefined;
  try {
    outcome = (await start()) ?? undefined;
  } catch (err) {
    ports.notice('hook_failed', `SessionStart hook failed: ${errMessage(err)}`);
    return;
  }
  const text = outcome?.additionalContext;
  if (text !== undefined) await appendHookContext(ports, text);
}

/** A prompt verdict, as the session needs to read it. */
export type PromptGateOutcome =
  | { blocked: true; reason: string }
  | { blocked: false; context?: string };

/**
 * Run the `userPromptSubmit` chain and classify its verdict.
 *
 * A hook that throws is reported and treated as "no verdict": a prompt the
 * operator typed must not be swallowed because an observer broke.
 */
export async function runPromptGate(
  ports: SessionHookPorts,
  gate: () => Promise<{ action: 'block'; reason?: string } | { additionalContext?: string } | void | undefined>,
): Promise<PromptGateOutcome> {
  let verdict: { action: 'block'; reason?: string } | { additionalContext?: string } | undefined;
  try {
    verdict = (await gate()) ?? undefined;
  } catch (err) {
    ports.notice('hook_failed', `UserPromptSubmit hook failed: ${errMessage(err)}`);
    return { blocked: false };
  }
  if (verdict === undefined) return { blocked: false };
  if ('action' in verdict && verdict.action === 'block') {
    const reason = verdict.reason !== undefined && verdict.reason.length > 0 ? verdict.reason : 'prompt blocked by a hook';
    return { blocked: true, reason };
  }
  const context = 'additionalContext' in verdict ? verdict.additionalContext : undefined;
  return context !== undefined && context.length > 0 ? { blocked: false, context } : { blocked: false };
}
