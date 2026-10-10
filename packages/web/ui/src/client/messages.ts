/**
 * The transcript domain: kernel events that touch the block list, and the
 * block primitives they are built from. One rule every case follows: an event
 * either appends a row, rewrites the ONE row it belongs to, or says something
 * in a hint. (`state-events.ts` classifies and dispatches; this module owns
 * the transcript half of that switch.)
 */
import type { KernelEvent, SubagentProgress, ToolCallView, ToolResultView } from '../types.js';
import type { Block, Draft, SubRow, UiState } from '../state.js';
import { upsertJobRow } from '../rightbar/tasks-model.js';

/** Events that only touch the transcript (block list). */
export type TranscriptEvent = Extract<
  KernelEvent,
  {
    type:
      | 'user_message'
      | 'text_delta'
      | 'reasoning_delta'
      | 'tool_call_start'
      | 'tool_call_result'
      | 'tool_progress'
      | 'job_update'
      | 'subagent_update'
      | 'llm_retry'
      | 'empty_completion'
      | 'command'
      | 'done';
  }
>;

export function reduceTranscript(
  state: UiState,
  event: TranscriptEvent,
  view: ToolCallView | undefined,
  resultView: ToolResultView | undefined,
  now: number,
): UiState {
  switch (event.type) {
    case 'user_message': {
      // The message's own timestamp: the row's clock reads the same here as it
      // does on replay (the log carries it, so neither path invents one).
      //
      // The image refs travel the same way, so a prompt that just went out draws
      // its attachment from the identical source the replay will use — the live
      // row and the reloaded row cannot disagree about what was attached.
      const images = event.message.images;
      return push(state, {
        kind: 'user',
        text: event.message.content,
        ts: event.message.ts,
        ...(images !== undefined && images.length > 0
          ? { images: images.map((image) => ({ id: image.id, mediaType: image.mediaType })) }
          : {}),
      });
    }
    case 'text_delta':
      return streamBlock(state, 'text', event.text, now);
    case 'reasoning_delta':
      return streamBlock(state, 'reasoning', event.text, now);
    case 'tool_call_start':
      return push(state, {
        kind: 'tool',
        callId: event.call.id,
        name: event.call.name,
        args: event.call.rawArgs,
        ts: now,
        // The host resolves this from the LIVE tool registry; a client that
        // somehow got no view still renders (generic card from name+args).
        view: view ?? { card: 'generic', kind: 'other', title: event.call.name },
      });
    case 'tool_call_result':
      return markToolResult(state, event.call.id, resultView, event.result.content);
    case 'tool_progress': {
      const tail = lastLine(event.text);
      if (tail.length === 0) return state;
      return { ...state, blocks: mapTool(state.blocks, event.callId, (b) => (b.result === undefined ? { ...b, tail } : b)) };
    }
    case 'job_update': {
      // One fact, two readings: the transcript block (the line a reloaded
      // session draws) and the 任务 page's list, when it is open. The host
      // scopes `job_update` to the current session (`job-listener.ts`), so a
      // live row can never be another conversation's job — and a list the
      // reader has not asked for yet (`jobs === null`) stays null instead of
      // materializing rows for a page nobody opened.
      const next = upsertRow(state, `job:${event.job.id}`, (id) => ({ id, kind: 'job', job: event.job }));
      return state.jobs === null ? next : { ...next, jobs: upsertJobRow(state.jobs, event.job) };
    }
    case 'subagent_update':
      return reduceSubagent(state, event.progress);
    case 'llm_retry': {
      // The failed attempt's partial output is DISCARDED, not kept (core's
      // `llm_retry` contract): the loop re-issues the same request, so leftover
      // text would have the retry's deltas appended to it.
      const dropped = dropPartial(state);
      return hint(dropped, `请求失败，已丢弃半截输出并重试（${event.attempt}/${event.maxRetries}）· ${event.error}`, 'warn');
    }
    case 'empty_completion':
      return hint(state, `空补全（${event.finishReason}），正在重发同一请求（${event.attempt}/${event.maxRetries}）`, 'warn');
    case 'command':
      return reduceCommand(state, event);
    case 'done':
      return { ...state, blocks: closeStreaming(state.blocks) };
  }
}

/**
 * Nested-subagent life as ONE row per label, rewritten in place (the same
 * "one place, later updates replace the first" rule the job rows follow).
 * `usage` frames are deliberately not drawn: the row shows the nested loop's
 * SHAPE while it runs (how many calls it has made, what it is calling) and its
 * totals once `done` lands, so no per-request accumulation is invented here.
 */
function reduceSubagent(state: UiState, progress: SubagentProgress): UiState {
  const id = `sub:${progress.label}`;
  const at = state.blocks.findIndex((b) => b.id === id);
  const prior = at < 0 ? undefined : state.blocks[at];
  const prev = prior?.kind === 'sub' ? prior.sub : undefined;
  const running: SubRow = { label: progress.label, status: 'running', calls: prev?.calls ?? 0 };
  switch (progress.type) {
    case 'start':
      return upsertRow(state, id, () => ({ id, kind: 'sub', sub: running }));
    case 'tool_call':
      return upsertRow(state, id, () => ({
        id,
        kind: 'sub',
        sub: { ...running, calls: running.calls + 1, detail: callLine(progress.call) },
      }));
    case 'done':
      return upsertRow(state, id, () => ({
        id,
        kind: 'sub',
        sub: { ...running, status: progress.status, calls: progress.usage.toolCalls, usage: progress.usage },
      }));
    case 'usage':
      return state;
  }
}

/** `read_file {"path": "a.ts"}` → `read_file {"path": "a.ts"}` one-line (no dumps). */
function callLine(call: { name: string; rawArgs: string }): string {
  const args = call.rawArgs.replace(/\s+/g, ' ').trim();
  return args.length === 0 ? call.name : `${call.name} ${args}`;
}

/** Append a delta to the open stream of the same kind, else open a new one. */
function streamBlock(state: UiState, kind: 'text' | 'reasoning', text: string, now: number): UiState {
  const last = state.blocks.at(-1);
  if (last?.kind === kind && last.streaming) {
    return { ...state, blocks: [...state.blocks.slice(0, -1), { ...last, text: last.text + text }] };
  }
  // A streamed block is stamped when it opens: the live path has no log yet,
  // and the tail's clock must not jump to the close time of a long turn.
  return push(state, { kind, text, streaming: true, ts: now });
}

/** Drop the failed attempt's trailing partial output (llm_retry). */
function dropPartial(state: UiState): UiState {
  let end = state.blocks.length;
  while (end > 0) {
    const block = state.blocks[end - 1];
    if (block === undefined || (block.kind !== 'text' && block.kind !== 'reasoning') || !block.streaming) break;
    end -= 1;
  }
  return end === state.blocks.length ? state : { ...state, blocks: state.blocks.slice(0, end) };
}

/**
 * Rewrite tool rows in place. An explicit id names its row; `undefined` is the
 * progress channel's "whatever is running" (the kernel publishes the call id it
 * last saw start, which is unknown while a nested dispatch streams), so it
 * resolves to the LAST unfinished row — never to all of them, which would smear
 * one tool's output across every open call in the transcript.
 */
function mapTool(blocks: Block[], callId: string | undefined, fn: (block: Extract<Block, { kind: 'tool' }>) => Block): Block[] {
  const at = callId === undefined ? lastUnfinishedTool(blocks) : blocks.findIndex((b) => b.kind === 'tool' && b.callId === callId);
  const target = at < 0 ? undefined : blocks[at];
  if (target === undefined || target.kind !== 'tool') return blocks;
  const next = [...blocks];
  next[at] = fn(target);
  return next;
}

function lastUnfinishedTool(blocks: readonly Block[]): number {
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block !== undefined && block.kind === 'tool' && block.result === undefined) return i;
  }
  return -1;
}

function markToolResult(state: UiState, callId: string, result: ToolResultView | undefined, output: string): UiState {
  return {
    ...state,
    blocks: mapTool(state.blocks, callId, (b) => ({
      ...b,
      // Without a view from the host the row keeps its call card and stays
      // in-flight rather than inventing a verdict from the raw text.
      result: result ?? b.result,
      output,
    })),
  };
}

/**
 * One row, rewritten in place by id (jobs and nested subagents both live this
 * way): injected where it first appeared, updated wherever it goes from there.
 * A row that outlives its run stays visible until it settles.
 */
function upsertRow(state: UiState, id: string, make: (id: string) => Block): UiState {
  const at = state.blocks.findIndex((b) => b.id === id);
  if (at < 0) return { ...state, blocks: [...state.blocks, make(id)] };
  const blocks = [...state.blocks];
  blocks[at] = make(id);
  return { ...state, blocks };
}

/**
 * One slash command's two events → one transcript row, closed in place.
 *
 * `run` appends, `done` closes the NEWEST row of that name rather than a fixed
 * id: running the same command twice is two lines, each where it happened (the
 * reader's question is "what did I do, in what order"), a `done` with no `run`
 * before it — a name the registry does not know — still leaves a line instead of
 * failing silently, and a repeated `done` settles the line already on screen
 * instead of stacking an empty one under it.
 */
function reduceCommand(state: UiState, event: Extract<KernelEvent, { type: 'command' }>): UiState {
  if (event.phase === 'run') return push(state, { kind: 'command', name: event.name, running: true });
  const done: Draft = {
    kind: 'command',
    name: event.name,
    running: false,
    ...(event.text !== undefined ? { text: event.text } : {}),
  };
  let at = -1;
  for (let index = state.blocks.length - 1; index >= 0; index -= 1) {
    const block = state.blocks[index];
    if (block?.kind === 'command' && block.name === event.name) { at = index; break; }
  }
  if (at < 0) return push(state, done);
  const open = state.blocks[at];
  if (open === undefined || open.kind !== 'command') return push(state, done);
  // The closing row KEEPS what the opening one carried when the new event says
  // nothing — a bare `done` must not blank the text already on screen.
  const text = event.text ?? open.text;
  const closed: Block = {
    id: open.id,
    kind: 'command',
    name: open.name,
    running: false,
    ...(text !== undefined ? { text } : {}),
  };
  return { ...state, blocks: state.blocks.map((block, index) => (index === at ? closed : block)) };
}

/** Append a freshly minted block (ids come from the state's counter — see `mint`). */
export function push(state: UiState, block: Draft): UiState {
  return mint({ ...state, blocks: closeStreaming(state.blocks) }, block);
}

export function hint(state: UiState, text: string, tone: 'info' | 'warn'): UiState {
  return mint(state, { kind: 'hint', text, tone });
}

function mint(state: UiState, block: Draft): UiState {
  const seq = state.seq + 1;
  return { ...state, seq, blocks: [...state.blocks, { ...block, id: `b${seq}` } as Block] };
}

export function closeStreaming(blocks: Block[]): Block[] {
  return blocks.map((b) => (b.kind === 'text' || b.kind === 'reasoning' ? (b.streaming ? { ...b, streaming: false } : b) : b));
}

function lastLine(text: string): string {
  const trimmed = text.replace(/\s+$/, '');
  return trimmed.slice(trimmed.lastIndexOf('\n') + 1);
}
