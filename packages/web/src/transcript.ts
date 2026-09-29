/**
 * Durable log → wire transcript (M11 批3): the WALK over the projected message
 * surface, in order, deciding which messages a reader sees at all. The `ready`
 * frame's replay baseline is computed **here, server-side**, so the browser owns
 * no log semantics — it draws blocks it is handed.
 *
 * Three shapes it points at instead of building: the context fragment's section
 * rows (`context-blocks.ts`), a tool call's render intent (`tool-block.ts`), and
 * a run's measurement, anchored by `core`'s `anchoredRunStats`.
 */
import {
  anchoredRunStats,
  COMPACT_SUMMARY_PREFIX,
  isAbortMarker,
  isCompactSummary,
  isContextFragment,
  type AgentMessage,
  type SessionEvent,
  type ToolResultMessage,
  type ToolViewSource,
} from '@nova-agent/core';
import { contextBlocks } from './context-blocks.js';
import { toolBlock } from './tool-block.js';
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
 *
 * @param events - the durable log, for the facts that are NOT messages: a
 *   run's measurement anchors to the message it closed, so the per-turn line
 *   survives a resume exactly where it was written.
 */
export function projectTranscript(
  messages: readonly AgentMessage[],
  tools: readonly ToolViewSource[],
  events: readonly SessionEvent[] = [],
): WireBlock[] {
  const results = new Map<string, ToolResultMessage>();
  for (const msg of messages) {
    if (msg.role === 'tool') results.set(msg.toolCallId, msg);
  }
  const runs = anchoredRunStats(events);
  const blocks: WireBlock[] = [];
  for (const msg of messages) {
    if (msg.role === 'user') {
      // The seeded session-start fragment is not a user turn — it is context the
      // kernel injected. It crosses the wire as ONE BLOCK PER SECTION (each
      // section is what a producer contributed: the environment, the operator's
      // directives, the AGENTS.md chain, the skills index), which is the shape
      // the reference draws and the only shape that names a producer per row.
      if (isContextFragment(msg)) {
        blocks.push(...contextBlocks(msg));
        continue;
      }
      // The abort marker is a message TO THE MODEL ("the user interrupted this
      // turn"), not something the user said: drawing it as a prompt bubble
      // fabricates a user turn on every replay of an interrupted session.
      if (isAbortMarker(msg)) {
        blocks.push({ kind: 'aborted' });
        continue;
      }
      // The compaction summary is core-written `user` text FOR the model, never
      // a prompt. `WireBlock` has no compaction variant, so it takes the context
      // row shape; the tag is core's own marker, so the row reads Chinese.
      if (isCompactSummary(msg)) {
        const body = msg.content.slice(COMPACT_SUMMARY_PREFIX.length).trimStart();
        blocks.push({ kind: 'context', tag: COMPACT_SUMMARY_PREFIX, form: 'text', text: body });
        continue;
      }
      blocks.push({
        kind: 'user',
        text: msg.content,
        ts: msg.ts,
        // The refs travel so a reload can re-fetch the pixels from the
        // id-addressed route. Only the id and media type are needed: the bytes
        // are fetched lazily by the browser, so a transcript with images costs
        // the wire nothing until they are actually drawn.
        ...(msg.images !== undefined && msg.images.length > 0
          ? { images: msg.images.map((image) => ({ id: image.id, mediaType: image.mediaType })) }
          : {}),
      });
      continue;
    }
    if (msg.role === 'assistant') {
      if (msg.content.length > 0) blocks.push({ kind: 'text', text: msg.content, ts: msg.ts });
      for (const call of msg.toolCalls ?? []) {
        blocks.push(toolBlock(call, results.get(call.id), msg.ts, tools));
      }
    }
    // The run's line lands after everything this message drew: it measured the
    // whole message, so it reads as that message's closing line.
    const stats = runs.get(msg.id);
    if (stats !== undefined) blocks.push({ kind: 'meta', stats, ts: stats.startedAt });
  }
  return blocks;
}
