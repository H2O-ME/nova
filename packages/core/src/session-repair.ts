/**
 * Repairing a turn that ended with tool calls nobody answered.
 *
 * "One result per call" is a surface contract the model depends on: a request
 * built from an assistant message whose calls have no results is malformed, so
 * an aborted or crashed run has to be made whole before the next request. The
 * rule is one rule — which call ids are missing a result, and what a
 * synthesized result looks like — and both callers need it: the run loop for
 * the in-memory surface, the kernel handle for the durable log (whose repair
 * also has to reach the surface). `missingToolResults` is that rule; the two
 * callers are the two scopes it runs over.
 */
import { newId } from './ids.js';
import { NOT_EXECUTED_GUIDANCE } from './agent/options.js';
import type { Session } from './session.js';
import type { AgentMessage, ToolResultMessage } from './types.js';

/** A NOT_EXECUTED result for every assistant call id that has none. */
export function missingToolResults(messages: readonly AgentMessage[]): ToolResultMessage[] {
  const answered = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool') answered.add(msg.toolCallId);
  }
  const missing: ToolResultMessage[] = [];
  for (const msg of messages) {
    if (msg.role !== 'assistant' || msg.toolCalls === undefined) continue;
    for (const call of msg.toolCalls) {
      if (answered.has(call.id)) continue;
      answered.add(call.id);
      missing.push({
        id: newId('msg'),
        ts: Date.now(),
        role: 'tool',
        toolCallId: call.id,
        name: call.name,
        content: NOT_EXECUTED_GUIDANCE,
      });
    }
  }
  return missing;
}

/**
 * Repair an abandoned turn's LOG (assistant tool_calls without results):
 * synthesize the missing results into the log and fill any hole left in the
 * live surface. Idempotent (it scans the log), so it is safe to run even when
 * the run loop's own surface cleanup already fired.
 */
export async function persistMissingToolResults(
  session: Session,
  messages: AgentMessage[],
): Promise<number> {
  const loggedResults = new Set<string>();
  for (const msg of session.allMessages()) {
    if (msg.role === 'tool') loggedResults.add(msg.toolCallId);
  }
  const missing = missingToolResults(session.allMessages());
  if (missing.length === 0) return 0;
  const surfaceResults = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool') surfaceResults.add(msg.toolCallId);
  }
  for (const result of missing) {
    await session.append(result);
    if (!surfaceResults.has(result.toolCallId)) {
      surfaceResults.add(result.toolCallId);
      messages.push(result);
    }
  }
  return missing.length;
}
