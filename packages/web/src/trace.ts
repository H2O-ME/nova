/**
 * Durable log → wire trace (the header's 轨迹 view). The session log is an
 * append-only event stream (session log v2: `message` / `compaction/*` /
 * `todo/write` / `approval` / `workspace` / `code-dispatch`), and this module
 * is its ONE projection for a reader: every event becomes one row carrying the
 * facts the surface needs to word it. Nothing here adds prose — a surface owns
 * its wording (`ui/src/trace-view.ts`), and the two must not disagree about
 * what happened.
 *
 * Rows keep the log's own order (oldest first, the paging tail is the newest),
 * and a message's preview is bounded here rather than in the surface, so a
 * 40KB tool result cannot ride the wire just to be truncated by every client.
 */
import type { AgentMessage, SessionEvent } from '@nova-agent/core';
import { isContextFragment } from '@nova-agent/core';
import type { WireTraceRow } from './protocol.js';

/** Longest message preview a row carries (one line, capped). */
const PREVIEW_CHARS = 200;

/** One line's worth of a message body: first non-empty line, capped. */
function preview(text: string): string {
  const line = text.split('\n').find((candidate) => candidate.trim().length > 0)?.trim() ?? '';
  return line.length > PREVIEW_CHARS ? `${line.slice(0, PREVIEW_CHARS)}…` : line;
}

/** The role word a message row reports (a role this build does not know stays 'other'). */
function roleOf(message: AgentMessage): 'user' | 'assistant' | 'tool' | 'other' {
  return message.role === 'user' || message.role === 'assistant' || message.role === 'tool'
    ? message.role
    : 'other';
}

/** One message event as a trace row. */
function messageRow(event: Extract<SessionEvent, { type: 'message' }>): WireTraceRow {
  const { message } = event;
  return {
    kind: 'message',
    ts: message.ts,
    role: roleOf(message),
    preview: preview(message.content),
    tools: message.role === 'assistant' ? (message.toolCalls?.length ?? 0) : 0,
    // The seeded context fragment is a user message in the log, but nobody
    // typed it: the row says what it is rather than showing the reader an
    // `<environment>` line attributed to themselves.
    ...(isContextFragment(message) ? { context: true } : {}),
    ...(message.role === 'tool' ? { name: message.name } : {}),
  };
}

/**
 * Project the durable event stream into trace rows.
 * @param events - `Session.events`, in log order.
 * @returns one row per event, in the same order.
 */
export function projectTrace(events: readonly SessionEvent[]): WireTraceRow[] {
  const rows: WireTraceRow[] = [];
  for (const event of events) {
    switch (event.type) {
      case 'message':
        rows.push(messageRow(event));
        break;
      case 'compaction/start':
        rows.push({ kind: 'compaction', ts: event.at, phase: 'start', trigger: event.trigger });
        break;
      case 'compaction/summary':
        rows.push({ kind: 'compaction', ts: event.at, phase: 'summary', tokens: event.shadowedTokenCount });
        break;
      case 'compaction/end':
        rows.push({
          kind: 'compaction',
          ts: event.at,
          phase: 'end',
          ...(event.error !== undefined ? { error: event.error } : {}),
        });
        break;
      case 'todo/write':
        rows.push({
          kind: 'todo',
          ts: event.at,
          total: event.todos.length,
          open: event.todos.filter((todo) => todo.status !== 'completed').length,
        });
        break;
      case 'approval':
        rows.push({
          kind: 'approval',
          ts: event.at,
          tool: event.toolName,
          request: event.kind,
          outcome: event.outcome,
        });
        break;
      case 'workspace':
        rows.push({ kind: 'workspace', ts: event.at, path: event.path });
        break;
      case 'code-dispatch':
        rows.push({
          kind: 'dispatch',
          ts: event.at,
          tool: event.toolName,
          isError: event.isError,
        });
        break;
      case 'run/stats':
        rows.push({ kind: 'run', ts: event.at, stats: event.stats });
        break;
    }
  }
  return rows;
}