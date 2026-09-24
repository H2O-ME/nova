/**
 * The transcript's flow: blocks in, `ChatView` rows out. This is the one place
 * that decides which component renders which block — the block union is the
 * reducer's contract (`state.ts`), the components are the ported surfaces, and
 * neither side knows about the other.
 *
 * Rows are grouped by the flow kinds `ChatView` reads: `user` (own words —
 * its arrival scrolls to the bottom), `assistant`, `process` (reasoning, meta,
 * tails — the collapsible machinery), `tool`, `notice` (hints and notices).
 */
import type { ReactNode } from 'react';
import { AssistantMessage, AssistantTailRow, MetaRow, UserMessageRow } from './chat/MessageItem.js';
import { ChatHintRow, type ChatFlowRow, type ChatTurnStatus } from './chat/ChatView.js';
import { ContextInjectionRow } from './chat/ContextInjectionRow.js';
import { ReasoningRow } from './chat/ReasoningRow.js';
import { ToolRow } from './tool/ToolRow.js';
import { JobRow, CommandRow, SubagentRow } from './flow/StatusRows.js';
import type { Block } from './state.js';
import type { TurnPhase } from './types.js';

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
  compacting: '压缩会话',
  retrying: '重试中',
};

/** The status pill for a running turn; null when nothing is in flight. */
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
}

/**
 * Map the reducer's blocks onto flow rows.
 * @param blocks - the session's blocks in order.
 * @param options - the few facts a row needs from the frame.
 * @returns one row per block, plus the turn tail the assistant's last message
 *   earns once its turn has finished.
 */
export function flowRows(blocks: readonly Block[], options: FlowOptions): ChatFlowRow[] {
  const rows: ChatFlowRow[] = [];
  const tailIndex = lastTextIndex(blocks);
  blocks.forEach((block, index) => {
    const key = block.id;
    rows.push({ key, kind: flowKind(block), node: rowNode(block, options, index === tailIndex) });
  });
  return rows;
}

/** The index of the last assistant text in a finished turn (-1 when none). */
function lastTextIndex(blocks: readonly Block[]): number {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block === undefined) continue;
    if (block.kind === 'text') return block.streaming ? -1 : index;
    // A hint or a live row after the text means the turn is still moving.
    if (block.kind === 'reasoning' || block.kind === 'job' || block.kind === 'sub') return -1;
  }
  return -1;
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
      // Context rows ride the process group: they are chrome above the first
      // turn, not something the user or the model said in it.
      return 'process';
  }
}

function rowNode(block: Block, options: FlowOptions, withTail: boolean): ReactNode {
  switch (block.kind) {
    case 'user':
      return <UserMessageRow text={block.text} time={block.ts} />;
    case 'text':
      return (
        <>
          <AssistantMessage text={block.text} streaming={block.streaming} />
          {withTail && <AssistantTailRow text={block.text} />}
        </>
      );
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
      return <MetaRow stats={block.stats} />;
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