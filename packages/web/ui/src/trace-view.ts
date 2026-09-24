/**
 * The 轨迹 view's words. Shape arrives on the wire (`WireTraceRow`: a role, a
 * count, an outcome); this module is where a reader's language is applied to it,
 * and it stays pure so the mapping is pinned without a DOM.
 *
 * The rule the label set follows: say what the log recorded and nothing more.
 * A row never summarizes an outcome the event does not state — an approval row
 * prints the decision the log carries (`allow` / `deny` / `always`), not a
 * verdict word like "已批准" that would hide which of the three it was.
 */
import { runMetaText } from './format.js';
import type { WireTraceRow } from './types.js';

/** One row's ready-to-render text. */
export interface TraceRowText {
  /** What this row is (the left column). */
  label: string;
  /** The row's one-line body (the middle), when it has one. */
  detail?: string;
  /** The right-hand reading (counts, outcomes), when it has one. */
  trailing?: string;
}

/** The role words a message row uses. */
const ROLE_LABEL: Record<'user' | 'assistant' | 'tool' | 'other', string> = {
  user: '用户消息',
  assistant: '助手回复',
  tool: '工具结果',
  other: '消息',
};

/** The compaction phases. */
const COMPACTION_LABEL: Record<'start' | 'summary' | 'end', string> = {
  start: '压缩开始',
  summary: '压缩摘要',
  end: '压缩结束',
};

/** The approval outcomes, printed as the log records them. */
const OUTCOME_LABEL: Record<'allow' | 'deny' | 'always', string> = {
  allow: '本次允许',
  deny: '拒绝',
  always: '总是允许',
};

/** Thousands separators for token counts (`12,345`). */
function tokens(count: number): string {
  return count.toLocaleString('en-US');
}

/**
 * Word one trace row.
 * @param row - a row from the `trace` frame.
 * @returns its label, body line and trailing reading.
 */
export function traceRowText(row: WireTraceRow): TraceRowText {
  switch (row.kind) {
    case 'message': {
      // The seeded fragment reads as what it is — an injection — rather than as
      // a user turn the reader never wrote.
      const text: TraceRowText = { label: row.context === true ? '上下文注入' : ROLE_LABEL[row.role] };
      if (row.preview.length > 0) text.detail = row.preview;
      // The tool-call count belongs to the assistant message that carried the
      // calls; a result message names the tool it came from instead.
      if (row.role === 'assistant' && row.tools > 0) text.trailing = `${row.tools} 次工具调用`;
      if (row.name !== undefined) text.trailing = row.name;
      return text;
    }
    case 'compaction': {
      const text: TraceRowText = { label: COMPACTION_LABEL[row.phase] };
      if (row.trigger !== undefined) text.detail = row.trigger === 'auto' ? '自动触发' : '手动触发';
      if (row.tokens !== undefined) text.trailing = `折叠 ${tokens(row.tokens)} tok`;
      if (row.error !== undefined) text.detail = `出错：${row.error}`;
      return text;
    }
    case 'todo':
      // An empty snapshot is a real write (it retires the plan), so it says so
      // rather than rendering "0 / 0".
      return row.total === 0
        ? { label: '计划快照', detail: '清空计划' }
        : { label: '计划快照', trailing: `${row.open} / ${row.total} 未完成` };
    case 'approval':
      return {
        label: '审批',
        detail: `${row.tool} · ${row.request}`,
        trailing: OUTCOME_LABEL[row.outcome],
      };
    case 'workspace':
      return { label: '工作区', detail: row.path };
    case 'dispatch':
      return {
        label: 'PTC 子调用',
        detail: row.tool,
        trailing: row.isError ? '失败' : '成功',
      };
    case 'run':
      // The run's own measurement row: worded by the SAME formatter the
      // transcript's meta line uses (`runMetaText`), so the log's row and the
      // conversation's line cannot describe one run two different ways.
      return { label: '运行量测', detail: runMetaText(row.stats) };
  }
}

