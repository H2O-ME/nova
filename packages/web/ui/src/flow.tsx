/**
 * The transcript's flow: blocks in, `ChatView` rows out. This is the one place
 * that decides which component renders which block — the block union is the
 * reducer's contract (`state.ts`), the components are the ported surfaces, and
 * neither side knows about the other.
 *
 * Rows are grouped by the flow kinds `ChatView` reads: `user` (own words —
 * its arrival scrolls to the bottom), `assistant`, `process` (the turn
 * headers, reasoning, tools — the collapsible machinery), `tool`, `notice`
 * (hints and notices).
 *
 * Turns: every user block opens one, and its process rows (reasoning, tools,
 * jobs, subagents) fold behind the turn's header — the harness's
 * TurnProcessNodeView rule. A settled turn starts collapsed (the header's
 * `用时 X` is the summary); the running turn and any turn the reader opened
 * stay expanded. A turn's `run_stats` block is consumed by its header and its
 * tail's usage pill instead of printing as a standalone row.
 */
import type { ReactNode } from 'react';
import { AssistantMessage, AssistantTailRow, UserMessageRow } from './chat/MessageItem.js';
import { ChatHintRow, type ChatFlowRow, type ChatTurnStatus } from './chat/ChatView.js';
import { ContextInjectionRow } from './chat/ContextInjectionRow.js';
import { ReasoningRow } from './chat/ReasoningRow.js';
import { TurnHeader } from './chat/TurnHeader.js';
import { TurnUsagePill } from './chat/TurnUsagePill.js';
import { ToolRow } from './tool/ToolRow.js';
import { JobRow, CommandRow, SubagentRow } from './flow/StatusRows.js';
import type { Block } from './state.js';
import type { RunStats, TurnPhase } from './types.js';
import { runDurationText } from './format.js';

/**
 * The live turn-status pill's words, one entry per kernel phase that can be
 * reported *while a run is in flight*. `idle` is absent on purpose rather than
 * mapped to a placeholder: `turnStatus` returns before it looks a label up when
 * nothing is running, so `idle` cannot reach this map. Typing the record over
 * `Exclude<TurnPhase, 'idle'>` is what makes a *new* kernel phase a compile
 * error instead of a silent 「工作中」 — the whole point of the guard.
 */
const PHASE_LABEL: Record<Exclude<TurnPhase, 'idle'>, string> = {
  thinking: '思考中',
  writing: '生成中',
  tool: '执行工具',
  waiting_approval: '等待审批',
  waiting_question: '等待回答',
  compacting: '压缩会话',
  retrying: '重试中',
};

/** The status label for a running turn; null when nothing is in flight. */
export function turnStatus(phase: TurnPhase | 'disconnected', running: boolean): ChatTurnStatus | null {
  if (!running) return null;
  // Reaching here with `idle`/`disconnected` is out of contract (`chromeView`
  // counts both as not-running, so `running` would be false), but the pill
  // still owes the operator words rather than an absent lookup.
  if (phase === 'idle' || phase === 'disconnected') return { label: '工作中' };
  return { label: PHASE_LABEL[phase] };
}

export interface FlowOptions {
  /** No run is in flight: an unfinished tool call renders as stopped, not live. */
  idle: boolean;
  /** The tool whose detail panel is open (its row keeps the selected state). */
  selectedCallId: string | null;
  onOpenTool: (callId: string) => void;
  onStopJob: (id: string) => void;
  /** The session's root, for the terminal card's prompt hint. */
  cwd?: string | undefined;
  /** The live turn's label (null when idle); the running turn's header reads it. */
  runningStatus: ChatTurnStatus | null;
  /** Turn ids the reader opened; settled turns start collapsed without one. */
  openTurns: ReadonlySet<string>;
  onToggleTurn: (id: string) => void;
  /** The in-force model's display name, for the tail's usage panel. */
  modelName: string | null;
}

/** The block kinds a turn's header folds. */
function isProcessBlock(block: Block): boolean {
  return (
    block.kind === 'reasoning' || block.kind === 'tool' || block.kind === 'job' || block.kind === 'sub'
    || block.kind === 'context'
  );
}

/** The last `run_stats` of a turn span (the kernel closes a run with one). */
function spanMeta(span: readonly Block[]): RunStats | undefined {
  for (let index = span.length - 1; index >= 0; index -= 1) {
    const block = span[index];
    if (block === undefined) continue;
    if (block.kind === 'meta') return block.stats;
  }
  return undefined;
}

/**
 * Whether a turn closes on a user-facing reply — the reference's
 * `endsWithResponse`. The decisive block is the turn's LAST substantive
 * assistant content, and trailing empty text or reasoning is skipped on the way
 * to it (the reference's `findLast`). A turn whose final act is a tool call is
 * therefore NOT a reply: there is no answer for the closing chrome to sit under,
 * so it stays hover-only even on the newest turn.
 * @param span - one turn's blocks.
 * @returns whether the tail should reveal without hover.
 */
function endsWithReply(span: readonly Block[]): boolean {
  for (let at = span.length - 1; at >= 0; at -= 1) {
    const inner = span[at];
    if (inner === undefined) continue;
    if (inner.kind !== 'text' && inner.kind !== 'reasoning' && inner.kind !== 'tool') continue;
    if (inner.kind !== 'tool' && inner.text.trim() === '') continue;
    return inner.kind === 'text';
  }
  return false;
}

/**
 * Map the reducer's blocks onto flow rows.
 * @param blocks - the session's blocks in order.
 * @param options - the few facts a row needs from the frame.
 * @returns one row per visible block plus each turn's header row; meta blocks
 *   ride their turn's header and tail instead of printing standalone.
 */
export function flowRows(blocks: readonly Block[], options: FlowOptions): ChatFlowRow[] {
  const rows: ChatFlowRow[] = [];
  // Context injections logged before the first user block (the session's
  // opening fragments) belong to that first turn's process group — the
  // harness folds its context rows behind the same disclosure as the steps,
  // so the transcript opens on the reader's words, not chrome. They ride the
  // next turn's header; a log that never reaches a user block prints them
  // standalone (the trace view holds them regardless).
  let pendingContext: Block[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block = blocks[index];
    if (block === undefined) break;
    if (block.kind !== 'user') {
      // Pre-turn chrome and standalone rows. A meta outside any turn (it
      // cannot happen today) has no header to ride and prints nowhere.
      if (block.kind === 'context') {
        pendingContext.push(block);
      } else if (block.kind !== 'meta') {
        rows.push({ key: block.id, kind: flowKind(block), node: rowNode(block, options) });
      }
      index += 1;
      continue;
    }
    // One turn: the user block and everything up to (not including) the next.
    let end = index + 1;
    while (end < blocks.length && blocks[end]?.kind !== 'user') end += 1;
    const span = blocks.slice(index, end);
    const meta = spanMeta(span);
    const opening = pendingContext;
    pendingContext = [];
    const hasProcess = span.some(isProcessBlock) || opening.length > 0;
    const isLastSpan = end >= blocks.length;
    const running = options.runningStatus !== null && isLastSpan;
    const turnKey = block.id;
    const open = running || options.openTurns.has(turnKey);
    // The turn's tail sits on its LAST settled text (the answer's closing
    // chrome); the latest settled turn reveals it without hover.
    let tailAt = -1;
    for (let at = index; at < end; at += 1) {
      const inner = blocks[at];
      if (inner?.kind === 'text' && !inner.streaming) tailAt = at;
    }
    let headerOut = false;
    for (let at = index; at < end; at += 1) {
      const inner = blocks[at];
      if (inner === undefined) continue;
      if (inner.kind === 'user') {
        // The bubble first, the header right under it — the harness reads
        // top-down as [user] → [用时 X] → [steps] → [answer].
        rows.push({ key: inner.id, kind: 'user', node: rowNode(inner, options) });
      }
      if (!headerOut) {
        headerOut = true;
        rows.push({
          key: `turn:${turnKey}`,
          kind: 'process',
          node: (
            <TurnHeader
              label={running && options.runningStatus !== null ? options.runningStatus.label
                : meta !== undefined ? `用时 ${runDurationText(meta.durationMs)}`
                : '已完成工作'}
              running={running}
              startTs={block.ts}
              collapsible={!running && hasProcess}
              open={open}
              turnKey={turnKey}
              messageCount={span.filter((b) => b.kind === 'text' || b.kind === 'user').length}
              toolCallCount={span.filter((b) => b.kind === 'tool').length}
              subagentCount={span.filter((b) => b.kind === 'sub').length}
              onToggle={() => { options.onToggleTurn(turnKey); }}
            />
          ),
        });
        // The opening context rows are the group's earliest members (they
        // entered the log before the prompt did).
        if (open) {
          for (const ctx of opening) {
            rows.push({
              key: ctx.id,
              kind: flowKind(ctx),
              group: { id: `group:${turnKey}`, live: running },
              node: rowNode(ctx, options),
            });
          }
        }
      }
      if (inner.kind === 'user' || inner.kind === 'meta') continue;
      if (isProcessBlock(inner) && !open) continue;
      // The turn's ANSWER is its last settled text; every text before it is a
      // step of the same act (prose the model wrote on the way to the answer),
      // and the reference folds those into the process group with the tool
      // rows. Without this a settled turn reads as several equal answers.
      const isAnswer = inner.kind === 'text' && at === tailAt;
      if (inner.kind === 'text' && !isAnswer && !open) continue;
      // A process row carries its turn's group id; the renderer wraps adjacent
      // members in one bounded box. Tagging (rather than splicing here) keeps
      // this list in LOG ORDER — the answer that arrives between two steps
      // stays where the log put it.
      const grouped = isProcessBlock(inner) || (inner.kind === 'text' && !isAnswer);
      rows.push({
        key: inner.id,
        kind: flowKind(inner),
        ...(grouped ? { group: { id: `group:${turnKey}`, live: running } } : {}),
        node: rowNode(inner, options),
      });
      // The turn's closing chrome follows its answer IMMEDIATELY as its own
      // flow row — the reference's separate `turn-tail` node, a sibling of the
      // answer rather than part of it. Emitting here (not after the span) keeps
      // it adjacent: a trailing hint would otherwise print before the footer.
      // The two offsets compose: the tail row's flow gap separates the footer
      // from the answer, and the footer's own 4px lead-in adds to it. The gap is
      // deliberately the tight tier (8px, not the column's 16px) — see
      // `ChatView.module.css` and `docs/dsh-parity-inventory.md`. Nesting both
      // in one row would silently spend the 4px alone.
      if (isAnswer && meta !== undefined) {
        rows.push({
          key: `tail:${turnKey}`,
          kind: 'tail',
          node: (
            <AssistantTailRow
              text={inner.text}
              time={inner.ts}
              // The reference's `endsWithResponse`: the tail reveals without
              // hover when its turn is the last one AND closes on a user-facing
              // reply. Two deliberate details — it is NOT gated on the turn
              // still running (the reference reads the timeline, not the run
              // state), and a turn whose last content is a tool call is
              // hover-only even on the newest turn, because protocol material
              // is not an answer to act on.
              reveal={isLastSpan && endsWithReply(span) ? 'always' : 'hover'}
              usageAction={<TurnUsagePill stats={meta} modelName={options.modelName} />}
            />
          ),
        });
      }
    }
    index = end;
  }
  // A context block with no turn to ride (a truncated baseline): print it
  // rather than drop it — the trace view is the audit lane, not the only one.
  for (const ctx of pendingContext) {
    rows.push({ key: ctx.id, kind: flowKind(ctx), node: rowNode(ctx, options) });
  }
  return rows;
}

function flowKind(block: Block): ChatFlowRow['kind'] {
  switch (block.kind) {
    case 'user':
      return 'user';
    case 'text':
      return 'assistant';
    case 'tool':
      return 'tool';
    case 'hint':
      return 'notice';
    case 'reasoning':
    case 'meta':
    case 'job':
    case 'sub':
    case 'command':
      return 'process';
    case 'context':
      // Context rows are process blocks: folded members of a turn's group
      // (chrome the header summarizes), standalone only with no turn to ride.
      return 'process';
  }
}

function rowNode(
  block: Block,
  options: FlowOptions,
): ReactNode {
  switch (block.kind) {
    case 'user':
      return (
        <UserMessageRow
          text={block.text}
          time={block.ts}
          {...(block.images !== undefined ? { images: block.images } : {})}
        />
      );
    case 'text':
      return <AssistantMessage text={block.text} streaming={block.streaming} />;
    case 'reasoning':
      return <ReasoningRow text={block.text} running={block.streaming} />;
    case 'tool':
      return (
        <ToolRow
          callId={block.callId}
          name={block.name}
          args={block.args}
          view={block.view}
          result={block.result}
          output={block.output}
          tail={block.tail}
          idle={options.idle}
          selected={block.callId === options.selectedCallId}
          anchorKey={block.id}
          onOpen={options.onOpenTool}
          cwd={options.cwd}
        />
      );
    case 'meta':
      // Rides the turn header + tail; never printed standalone.
      return null;
    case 'job':
      return <JobRow job={block.job} onStop={options.onStopJob} />;
    case 'sub':
      return <SubagentRow sub={block.sub} />;
    case 'command':
      return <CommandRow name={block.name} running={block.running} text={block.text} />;
    case 'hint':
      return <ChatHintRow text={block.text} tone={block.tone} />;
    case 'context':
      return (
        <ContextInjectionRow
          tag={block.tag}
          form={block.form}
          sections={block.sections}
          entries={block.entries}
          note={block.note}
          text={block.text}
        />
      );
  }
}
