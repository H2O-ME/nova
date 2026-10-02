/**
 * The turn grouping (`flowRows`): the harness's whole-Turn process rule pinned
 * in one place — a settled turn collapses to its `用时 X` header, the running
 * turn and any turn the reader opened stay expanded, a turn's `run_stats`
 * rides its header and its tail's usage pill instead of printing as a row,
 * context injections fold into their turn's process group like every other
 * step, and the latest settled turn reveals its tail (usage pill + clock)
 * without hover.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { flowRows, turnStatus } from '../src/flow.js';
import { presentationPolicyFor } from '../src/chat/transcript-view.js';
import type { Block } from '../src/state.js';
import type { RunStats } from '../src/types.js';

const options = (over: Partial<Parameters<typeof flowRows>[1]> = {}): Parameters<typeof flowRows>[1] => ({
  idle: true,
  selectedCallId: null,
  onOpenTool: () => {},
  onStopJob: () => {},
  runningStatus: null,
  openTurns: new Set(),
  onToggleTurn: () => {},
  modelName: null,
  policy: presentationPolicyFor('standard'),
  ...over,
});

const stats = (over: Partial<RunStats> = {}): RunStats => ({
  startedAt: new Date(2026, 8, 25, 1, 54).getTime(),
  durationMs: 5_600,
  firstTokenMs: 900,
  llmMs: 5_600,
  toolMs: 0,
  requests: 1,
  toolCalls: 0,
  retries: 0,
  promptTokens: 24_000,
  completionTokens: 209,
  cachedTokens: 0,
  ...over,
});

const noon = new Date();
noon.setHours(12, 0, 0, 0);

const blocks = (over: Partial<Record<number, Block>> = {}): Block[] => {
  const list: Block[] = [
    { id: 'c1', kind: 'context', tag: 'environment', form: 'snapshot', text: 'env' },
    { id: 'b1', kind: 'user', text: '第一问', ts: 1_000 },
    { id: 'b2', kind: 'reasoning', text: '想', streaming: false },
    { id: 'b3', kind: 'text', text: '答一', streaming: false },
    { id: 'b4', kind: 'meta', stats: stats() },
    { id: 'b5', kind: 'user', text: '第二问', ts: 2_000 },
    { id: 'b6', kind: 'text', text: '答二', streaming: false, ts: noon.getTime() },
    { id: 'b7', kind: 'meta', stats: stats({ startedAt: 2_500 }) },
  ];
  for (const [at, block] of Object.entries(over)) {
    if (block !== undefined) list[Number(at)] = block;
  }
  return list;
};

const keys = (rows: ReturnType<typeof flowRows>): string[] => rows.map((row) => row.key);

describe('flowRows turns', () => {
  it('collapses a settled turn to its header and consumes its meta row', () => {
    const rows = flowRows(blocks(), options());
    // The opening context injection (`c1`) folds behind the first turn's
    // header like every other process block: the transcript opens on the
    // reader's words, not chrome. Each turn's closing chrome is its own row
    // (`tail:<turn>`) right after its answer — the harness's separate
    // `turn-tail` node, so the column's 16px rhythm separates it from the
    // answer as a sibling.
    expect(keys(rows)).toEqual(['b1', 'turn:b1', 'b3', 'tail:b1', 'b5', 'turn:b5', 'b6', 'tail:b5']);
    // The header carries the duration; the meta ids appear nowhere.
    const header = renderToStaticMarkup(rows.find((row) => row.key === 'turn:b1')!.node);
    expect(header).toContain('用时 5秒');
    expect(header).toContain('aria-expanded="false"');
  });

  it('keeps a reader-opened turn expanded (its process rows reappear)', () => {
    const rows = flowRows(blocks(), options({ openTurns: new Set(['b1']) }));
    // The folded context rows are the group's earliest members: they entered
    // the log before the prompt did.
    expect(keys(rows)).toEqual(['b1', 'turn:b1', 'c1', 'b2', 'b3', 'tail:b1', 'b5', 'turn:b5', 'b6', 'tail:b5']);
    expect(renderToStaticMarkup(rows.find((row) => row.key === 'turn:b1')!.node)).toContain('data-open');
    expect(renderToStaticMarkup(rows.find((row) => row.key === 'c1')!.node)).toContain('上下文注入');
  });

  it('labels the running turn with the live phase and keeps it open', () => {
    const running = blocks({
      6: { id: 'b6', kind: 'text', text: '答二', streaming: true },
      7: { id: 'x', kind: 'hint', text: '占位', tone: 'info' },
    }).slice(0, 7);
    const rows = flowRows(running, options({ idle: false, runningStatus: { label: '生成中' } }));
    expect(keys(rows)).toEqual(['b1', 'turn:b1', 'b3', 'tail:b1', 'b5', 'turn:b5', 'b6']);
    const header = renderToStaticMarkup(rows.find((row) => row.key === 'turn:b5')!.node);
    expect(header).toContain('生成中');
    expect(header).toContain('data-running');
    // The still-running turn keeps its (earlier, settled) tail on hover only.
    const tail = renderToStaticMarkup(rows.find((row) => row.key === 'tail:b1')!.node);
    expect(tail).toContain('data-actions-reveal="hover"');
  });

  it('reveals the latest settled turn\'s tail with its usage pill and clock', () => {
    const rows = flowRows(blocks(), options({ modelName: 'DeepSeek V4 Flash' }));
    const tail = renderToStaticMarkup(rows.find((row) => row.key === 'tail:b5')!.node);
    expect(tail).toContain('data-actions-reveal="always"');
    expect(tail).toContain('用量 24.2K tok');
    // The closing clock rides after the usage slot (the harness passes the
    // message's own time to the tail).
    expect(tail).toContain('12:00');
    // The first turn's tail stays hover-gated but still exists.
    const earlier = renderToStaticMarkup(rows.find((row) => row.key === 'tail:b1')!.node);
    expect(earlier).toContain('data-actions-reveal="hover"');
  });

  it('keeps the tail hover-only when the newest turn ends on a tool call', () => {
    // The reference's `endsWithResponse` asks for the turn's LAST content, not
    // merely for the newest turn: a turn that goes on to call a tool closes on
    // protocol material, so there is no reply for the closing chrome to sit
    // under and the actions stay hover-gated. Reading only "is this the newest
    // turn" revealed them here.
    const turn: Block[] = [
      { id: 'u1', kind: 'user', text: '看一下', ts: 1_000 },
      { id: 't1', kind: 'text', text: '我先看一下', streaming: false, ts: 2_000 },
      { id: 'k1', kind: 'tool', callId: 'c1', name: 'read_file', args: '{}', view: { card: 'generic', kind: 'other', title: 'read_file' } },
      { id: 'm1', kind: 'meta', stats: stats() },
    ];
    const rows = flowRows(turn, options());
    const tail = renderToStaticMarkup(rows.find((row) => row.key === 'tail:u1')!.node);
    expect(tail).toContain('data-actions-reveal="hover"');
    // Reasoning after the answer is the same material: it is not a reply either.
    const trailingReasoning: Block[] = [...turn.slice(0, 3), { id: 'r2', kind: 'reasoning', text: '再想想', streaming: false }, turn[3]!];
    const again = flowRows(trailingReasoning, options());
    expect(renderToStaticMarkup(again.find((row) => row.key === 'tail:u1')!.node)).toContain('data-actions-reveal="hover"');
    // An empty settled text is skipped on the way to the real reply, which is
    // what makes the tail reveal again (the reference's `findLast` step).
    const emptyTrailing: Block[] = [
      { id: 'u2', kind: 'user', text: '第二问', ts: 1_000 },
      { id: 't3', kind: 'text', text: '这是答案', streaming: false, ts: 2_000 },
      { id: 't4', kind: 'text', text: '   ', streaming: false, ts: 3_000 },
      { id: 'm2', kind: 'meta', stats: stats() },
    ];
    const third = flowRows(emptyTrailing, options());
    expect(renderToStaticMarkup(third.find((row) => row.key === 'tail:u2')!.node)).toContain('data-actions-reveal="always"');
  });

  it('keeps the header to the reference shape: one label and a chevron, no readings line', () => {
    // The reference's `TurnProcessNodeView` is `[label][chevron]` and its sheet
    // has no detail class; the per-run readings (clock, TTFT, TPS) live in the
    // session-stats dialog and the trajectory table. Printing them under the
    // header duplicated the label's own 用时 and put a block of numbers where
    // the reference has nothing.
    const rows = flowRows(blocks(), options({ openTurns: new Set(['b5']) }));
    const open = renderToStaticMarkup(rows.find((row) => row.key === 'turn:b5')!.node);
    // The label is the run's whole-second duration, the reference's rounding.
    expect(open).toContain('用时 5秒');
    expect(open).not.toContain('首 token');
    expect(open).not.toContain('tok/s');
    // The removed readings still have their own home, so nothing was lost: the
    // session-stats pill's dialog carries LLM/tool time, average TTFT and TPS.
    expect(renderToStaticMarkup(rows.find((row) => row.key === 'tail:b5')!.node)).toContain('用量');
  });

  it('folds mid-turn context rows too, and keeps hints outside the groups', () => {
    const withChrome: Block[] = [
      ...blocks(),
      { id: 'c2', kind: 'context', tag: 'environment', form: 'snapshot', text: 'env2' },
      { id: 'h1', kind: 'hint', text: '本轮已中断', tone: 'warn' },
    ];
    const rows = flowRows(withChrome, options());
    // `c2` landed after the last turn's answer: it belongs to that turn's
    // group (folded, closed), in log order, while the hint prints outside.
    expect(keys(rows)).toEqual(['b1', 'turn:b1', 'b3', 'tail:b1', 'b5', 'turn:b5', 'b6', 'tail:b5', 'h1']);
    const reopened = flowRows(withChrome, options({ openTurns: new Set(['b5']) }));
    expect(keys(reopened)).toEqual(['b1', 'turn:b1', 'b3', 'tail:b1', 'b5', 'turn:b5', 'b6', 'tail:b5', 'c2', 'h1']);
  });

  it('prints context with no turn to ride instead of dropping it', () => {
    const rows = flowRows([{ id: 'c1', kind: 'context', tag: 'environment', form: 'snapshot', text: 'env' }], options());
    expect(keys(rows)).toEqual(['c1']);
  });

  it('folds mid-turn prose into the process group and groups it for the cap', () => {
    // One turn with TWO texts: the first is prose on the way to the answer (a
    // step of the same act), the second is the answer itself. Only the answer
    // stands as a peer of the header — the reference's answerStep rule.
    const turn: Block[] = [
      { id: 'c1', kind: 'context', tag: 'environment', form: 'snapshot', text: 'env' },
      { id: 'u1', kind: 'user', text: '第一问', ts: 1_000 },
      { id: 'r1', kind: 'reasoning', text: '想', streaming: false },
      { id: 't1', kind: 'text', text: '先说明一下', streaming: false },
      { id: 'k1', kind: 'tool', callId: 'c1', name: 'read_file', args: '{}', view: { card: 'generic', kind: 'other', title: 'read_file' } },
      { id: 't2', kind: 'text', text: '真正的答案', streaming: false },
      { id: 'm1', kind: 'meta', stats: stats() },
    ];
    const rows = flowRows(turn, options({ openTurns: new Set(['u1']) }));
    expect(keys(rows)).toEqual(['u1', 'turn:u1', 'c1', 'r1', 't1', 'k1', 't2', 'tail:u1']);
    // The step rows (context, reasoning, mid-turn prose, tool) carry the turn's
    // group; the answer and its closing footer do not.
    const grouped = rows.filter((row) => row.group !== undefined).map((row) => row.key);
    expect(grouped).toEqual(['c1', 'r1', 't1', 'k1']);
    expect(rows.find((row) => row.key === 't1')?.group).toEqual({ id: 'group:u1', live: false, summary: '已读取文件' });
    expect(rows.find((row) => row.key === 't2')?.group).toBeUndefined();
    expect(rows.find((row) => row.key === 'tail:u1')?.group).toBeUndefined();
    // Closed: the mid-turn prose is a step, so it folds with the tools and the
    // answer is the only text left standing.
    const closed = flowRows(turn, options());
    expect(keys(closed)).toEqual(['u1', 'turn:u1', 't2', 'tail:u1']);
  });
});

describe('flowRows × presentation policy', () => {
  // One settled turn with a reasoning + tool step, so every mode has something
  // to fold; a live variant keeps the tool call in flight (no result yet).
  const tool = (over: Partial<Extract<Block, { kind: 'tool' }>> = {}): Block => ({
    id: 'k1',
    kind: 'tool',
    callId: 'c1',
    name: 'read_file',
    args: '{"file_path":"src/a.ts"}',
    view: { card: 'generic', kind: 'other', title: 'read_file' },
    ...over,
  });
  const turn: Block[] = [
    { id: 'u1', kind: 'user', text: '问', ts: 1_000 },
    { id: 'r1', kind: 'reasoning', text: '想', streaming: false },
    tool(),
    { id: 't1', kind: 'text', text: '答', streaming: false },
    { id: 'm1', kind: 'meta', stats: stats() },
  ];
  const liveTurn: Block[] = [
    { id: 'u1', kind: 'user', text: '问', ts: 1_000 },
    { id: 'r1', kind: 'reasoning', text: '想', streaming: false },
    tool(),
  ];

  it('standard folds a settled turn; opening it reveals the group with its summary', () => {
    expect(keys(flowRows(turn, options()))).toEqual(['u1', 'turn:u1', 't1', 'tail:u1']);
    const rows = flowRows(turn, options({ openTurns: new Set(['u1']) }));
    // The group names the turn's ranked work; the answer and its footer are
    // NOT members.
    expect(rows.find((row) => row.key === 'r1')?.group).toEqual({ id: 'group:u1', live: false, summary: '已读取文件' });
    expect(rows.find((row) => row.key === 'k1')?.group).toEqual({ id: 'group:u1', live: false, summary: '已读取文件' });
    expect(rows.find((row) => row.key === 't1')?.group).toBeUndefined();
  });

  it('detailed keeps a RUNNING turn ungrouped (steps flat) but folds history', () => {
    const policy = presentationPolicyFor('detailed');
    const live = flowRows(liveTurn, options({ runningStatus: { label: '生成中' }, policy }));
    expect(keys(live)).toEqual(['u1', 'turn:u1', 'r1', 'k1']);
    expect(live.find((row) => row.key === 'k1')?.group).toBeUndefined();
    // A settled turn under the same mode still folds behind its header.
    expect(keys(flowRows(turn, options({ policy })))).toEqual(['u1', 'turn:u1', 't1', 'tail:u1']);
  });

  it('verbose unfolds everything: settled turns stay open and no groups exist', () => {
    const rows = flowRows(turn, options({ policy: presentationPolicyFor('verbose') }));
    expect(keys(rows)).toEqual(['u1', 'turn:u1', 'r1', 'k1', 't1', 'tail:u1']);
    expect(rows.every((row) => row.group === undefined)).toBe(true);
    // The header is a plain label here: nothing left to disclose.
    expect(renderToStaticMarkup(rows.find((row) => row.key === 'turn:u1')!.node)).not.toContain('aria-expanded');
  });

  it('compact and standard differ only in the LIVE title\'s detail half', () => {
    const live = (policy: Parameters<typeof presentationPolicyFor>[0]): ReturnType<typeof flowRows> =>
      flowRows(liveTurn, options({ runningStatus: { label: '生成中' }, policy: presentationPolicyFor(policy) }));
    // Both fold the running turn's steps into the same box…
    const compactGroup = live('compact').find((row) => row.key === 'k1')?.group;
    const standardGroup = live('standard').find((row) => row.key === 'k1')?.group;
    expect(compactGroup?.id).toBe('group:u1');
    expect(standardGroup?.id).toBe('group:u1');
    // …but compact's live title omits the current-action detail, standard's
    // carries it (the reference's liveProcessDetail flag).
    expect(compactGroup?.liveTitle).toBe('正在读取文件');
    expect(standardGroup?.liveTitle).toBe('正在读取文件 · src/a.ts');
  });

  it('compact withholds the settled reasoning preview that standard shows', () => {
    const open = { openTurns: new Set(['u1']) };
    const standardRow = renderToStaticMarkup(flowRows(turn, options(open)).find((row) => row.key === 'r1')!.node);
    const compactRow = renderToStaticMarkup(
      flowRows(turn, options({ ...open, policy: presentationPolicyFor('compact') })).find((row) => row.key === 'r1')!.node,
    );
    expect(standardRow).toContain('想');
    expect(compactRow).not.toContain('想');
    // A streaming row is never gated: its COMPLETED-paragraph tail is the live
    // cue, not a summary (a lone half-typed line shows none — by design).
    const streaming = flowRows(
      [{
        id: 'u2', kind: 'user', text: '问', ts: 1_000,
      }, { id: 'r2', kind: 'reasoning', text: '先看结构\n\n想到一半', streaming: true }],
      options({ runningStatus: { label: '生成中' }, policy: presentationPolicyFor('compact') }),
    );
    expect(renderToStaticMarkup(streaming.find((row) => row.key === 'r2')!.node)).toContain('先看结构');
  });
});

describe('turnStatus', () => {
  it('names every live phase and stays null when idle', () => {
    expect(turnStatus('writing', true)).toEqual({ label: '生成中' });
    expect(turnStatus('waiting_approval', true)).toEqual({ label: '等待审批' });
    expect(turnStatus('idle', false)).toBeNull();
  });
});
