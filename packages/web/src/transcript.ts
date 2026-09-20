/**
 * Durable log → wire transcript (M11 批3). The `ready` frame's replay baseline
 * is computed **here, server-side**, from `Session.deriveMessages()` output:
 * which messages are user-visible, how tool calls pair with their results, and
 * what each call's render intent is. The browser therefore owns no log
 * semantics at all — it draws blocks it is handed (and a surface that renders
 * the same log elsewhere reuses this projection instead of re-guessing).
 */
import { callViewOf, isContextFragment, resultViewOf, type AgentMessage, type ToolResultMessage, type ToolViewSource } from '@nova-agent/core';
import type { WireBlock } from './protocol.js';

/**
 * Project a conversation into renderable blocks. Tool calls pair with their
 * results by call id regardless of message order (the log is append-only but a
 * crashed run can leave a result orphaned) — an unmatched call keeps its view
 * with no result, and an unmatched result is dropped rather than invented.
 *
 * Each tool block also carries the result TEXT (the detail panel's content) and
 * a timestamp: the log is the only place a resumed session's rows can get
 * either, since the live stream's events are gone by then.
 */
export function projectTranscript(messages: readonly AgentMessage[], tools: readonly ToolViewSource[]): WireBlock[] {
  const results = new Map<string, ToolResultMessage>();
  for (const msg of messages) {
    if (msg.role === 'tool') results.set(msg.toolCallId, msg);
  }
  const blocks: WireBlock[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (isContextFragment(msg)) continue; // seeded session-start fragment, never user-visible
      blocks.push({ kind: 'user', text: msg.content });
      continue;
    }
    if (msg.role !== 'assistant') continue;
    if (msg.content.length > 0) blocks.push({ kind: 'text', text: msg.content });
    for (const call of msg.toolCalls ?? []) {
      const result = results.get(call.id);
      blocks.push({
        kind: 'tool',
        callId: call.id,
        name: call.name,
        args: call.rawArgs,
        view: callViewOf(tools, call),
        ts: result?.ts ?? msg.ts,
        ...(result !== undefined
          ? { result: resultViewOf(tools, call, result.content), output: result.content }
          : {}),
      });
    }
  }
  return blocks;
}