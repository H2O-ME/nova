/**
 * One tool call as a wire block: the call itself, its result when the log has
 * one, and the render intent resolved from the LIVE registry (a workspace switch
 * or a PTC rebuild swaps the host mid-session, so this is read per call, never
 * cached). The block also carries the result TEXT for the detail panel — the
 * model-facing message is already size-bounded, so it needs no cap of its own.
 *
 * Split from `transcript.ts` (the conversation walk): what a tool call LOOKS
 * like is the presentation seam, and it changes with the card vocabulary rather
 * than with the message order.
 */
import { callViewOf, resultViewOf, type ToolCall, type ToolResultMessage, type ToolViewSource } from '@nova-agent/core';
import type { WireBlock } from './protocol.js';

/** The transcript's tool block (its `kind` is fixed, so callers stay typed). */
export type ToolBlock = Extract<WireBlock, { kind: 'tool' }>;

/**
 * @param call - the call as the assistant message carried it.
 * @param result - its logged result, or undefined for a call the log never
 *   answered (the row then renders as unfinished, not as an empty success).
 * @param ts - the timestamp to fall back on (the message's own).
 */
export function toolBlock(
  call: ToolCall,
  result: ToolResultMessage | undefined,
  ts: number,
  tools: readonly ToolViewSource[],
): ToolBlock {
  return {
    kind: 'tool',
    callId: call.id,
    name: call.name,
    args: call.rawArgs,
    view: callViewOf(tools, call),
    ts: result?.ts ?? ts,
    ...(result !== undefined ? { result: resultViewOf(tools, call, result.content), output: result.content } : {}),
  };
}
