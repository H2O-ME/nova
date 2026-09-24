/**
 * The tool row's decision layer: everything a row decides *before* it draws.
 *
 * Ported from deepseek-harness `ui-tool`'s `models/tool-call-model.ts` (MIT) —
 * the variant→title mapping, `formatToolBody`, and the row-state semantics — and
 * `toolviews/todo-row.tsx`, whose summary/suffix split (the count clause
 * truncates, the parallel-active `+n` must not) is reproduced here.
 *
 * The harness keyed variants by **tool name**; this surface keys by the card the
 * host resolved (`view.card` / `body.kind`), which is this project's vocabulary
 * rule: a card this file has never seen still renders, it just lands in the
 * `others` / IN-OUT branch. The card data derivations themselves (diff rows, read
 * windows, search groups, plan counts, fold arithmetic) live in `cards.ts`.
 *
 * Nothing here touches the DOM: the row is then a projection, and every string
 * the reader sees (title word, summary, footnote, fold label) is asserted in
 * `test/tool-model.test.ts` without a browser.
 */
import type { CardBody, CardModel } from '../card-view.js';
import {
  diffFiles,
  diffTotals,
  matchTexts,
  planSummary,
  readWindow,
  searchGroups,
  type DiffFile,
  type ReadWindow,
  type SearchGroup,
} from './cards.js';
import type { FileDiff, ToolCallView, ToolResultView } from '../types.js';

/** The row's own tool variant (harness `ToolRowVariant`), derived from the card. */
export type RowVariant = 'search' | 'read' | 'bash' | 'write' | 'edit' | 'others';

/** Localized title per variant — verbatim harness `tool.title.*` copy. */
const VARIANT_TITLES: Record<RowVariant, string> = {
  search: '搜索',
  read: '读取',
  bash: 'Bash',
  write: '写入',
  edit: '编辑',
  others: '工具调用',
};

/** Kind words for cards with no more specific title (harness `tool.title.*`). */
const KIND_TITLES: Record<Extract<ToolCallView, { card: 'generic' }>['kind'], string> = {
  read: '读取',
  search: '搜索',
  edit: '编辑',
  write: '写入',
  execute: '执行',
  job: '后台任务',
  plan: '更新计划',
  other: '工具调用',
};

/** The row's four slots, as the harness `ToolRow` takes them. */
export interface RowSlots {
  /** The act's name — the row's non-shrinking title (harness `tool.title.*`). */
  title: string;
  /** The call's operand, ellipsized when the row is narrow. */
  summary: string;
  /** Draw the summary in the code font (commands, queries, paths). */
  mono: boolean;
  /** Trailing fragment kept outside the ellipsis; null = nothing trails. */
  suffix: string | null;
  /** How the suffix is drawn: diff totals, a failure, or quiet chrome. */
  suffixTone: 'diff' | 'fail' | 'muted' | null;
}

/** What `rowSlots` reads off the card render model (`card-view.ts`). */
export type SlotModel = Pick<CardModel, 'headline' | 'mono' | 'subtitle' | 'foot' | 'footTone' | 'body'>;

/**
 * The variant a row renders as: the result card decides first (a read result is
 * a read whatever tool produced it), then the call card.
 */
export function rowVariant(view: ToolCallView, body: CardBody): RowVariant {
  switch (body.kind) {
    case 'diff':
      return firstDiff(body.diffs)?.oldText === null ? 'write' : 'edit';
    case 'read':
      return 'read';
    case 'matches':
      return 'search';
    case 'plan':
      return 'others';
    case 'args':
    case 'none':
    case 'output':
    case 'text':
      return view.card === 'terminal' ? 'bash' : view.card === 'search' ? 'search' : 'others';
  }
}

/** Every slot the row draws, from the card model plus the call/result cards. */
export function rowSlots(input: { name: string; view: ToolCallView; model: SlotModel }): RowSlots {
  const { view, model } = input;
  // The plan row splits its summary: the count clause truncates, the
  // parallel-active `+n` must not (that is the whole reason the slot exists).
  // It carries nothing else — the harness's todo row shows counts, not a verdict.
  if (model.body.kind === 'plan') {
    const plan = planSummary(model.body.items);
    const extra = plan.activeExtra > 0 ? `+${plan.activeExtra}` : null;
    return {
      title: '更新任务清单',
      summary: planSummaryText(plan),
      mono: false,
      suffix: extra,
      suffixTone: extra === null ? null : 'muted',
    };
  }
  // A failure replaces the trailing fragment rather than supplementing it (the
  // harness rule): the failure line is what the reader needs, not a size count.
  const failure = model.footTone === 'fail';
  const totals = model.body.kind === 'diff' ? diffTotals(model.body.diffs) : null;
  // The `others` summary already carries the tool name, so its kind label would
  // only repeat it as a trailing fragment.
  const prefixed = view.card === 'generic' && view.kind === 'other' && input.name !== '';
  const subtitle = prefixed ? undefined : model.subtitle;
  return {
    title: rowTitle(view, model.body),
    summary: summaryText(input.name, view, model.headline),
    mono: model.mono,
    suffix: failure ? model.foot ?? null : quietSuffix(model.foot, totals, subtitle),
    suffixTone: suffixTone(failure, model.foot, totals, subtitle),
  };
}

/** The trailing fragment on a row that did not fail. */
function quietSuffix(
  foot: string | undefined,
  totals: { added: number; removed: number } | null,
  subtitle: string | undefined,
): string | null {
  if (foot !== undefined) return foot;
  if (totals !== null) return `+${totals.added} -${totals.removed}`;
  return subtitle ?? null;
}

function suffixTone(
  failure: boolean,
  foot: string | undefined,
  totals: { added: number; removed: number } | null,
  subtitle: string | undefined,
): RowSlots['suffixTone'] {
  if (failure) return 'fail';
  if (foot !== undefined) return 'muted';
  if (totals !== null) return 'diff';
  return subtitle === undefined ? null : 'muted';
}

/** The harness `others` variant keeps the tool name in the summary slot. */
function summaryText(name: string, view: ToolCallView, headline: string): string {
  return view.card === 'generic' && view.kind === 'other' && name !== ''
    ? `${name} · ${headline}`
    : headline;
}

/** The row title: the act's name, per card (harness `tool.title.*` literals). */
function rowTitle(view: ToolCallView, body: CardBody): string {
  switch (body.kind) {
    // A plan update has its own row title in the harness (`todo.rowTitle`).
    case 'plan':
      return '更新任务清单';
    case 'diff':
      return VARIANT_TITLES[rowVariant(view, body)];
    case 'read':
      return VARIANT_TITLES.read;
    case 'matches':
      return VARIANT_TITLES.search;
    case 'args':
    case 'none':
    case 'output':
    case 'text':
      if (view.card === 'terminal') return VARIANT_TITLES.bash;
      if (view.card === 'search') return VARIANT_TITLES.search;
      if (view.card === 'generic') return KIND_TITLES[view.kind];
      return VARIANT_TITLES.others;
  }
}

/** `3/5 已完成 · <active item>` — the harness `todo.completed` summary. */
function planSummaryText(plan: { done: number; total: number; activeContent: string | null }): string {
  const head = `${plan.done}/${plan.total} 已完成`;
  return plan.activeContent === null ? head : `${head} · ${plan.activeContent}`;
}

function firstDiff(diffs: readonly FileDiff[]): FileDiff | undefined {
  return diffs[0];
}

/** The expanded body's shape, per card. */
export type BodyShell =
  | {
      card: 'terminal';
      /** The command line, or null when the call card was not a terminal one. */
      command: string | null;
      output: string;
      /** undefined = still in flight (no pill), null = never exited (killed/aborted). */
      exitCode: number | null | undefined;
      running: boolean;
      /** The pill text for a non-zero or absent exit code; null = clean settle. */
      pill: string | null;
    }
  | { card: 'diff'; files: readonly DiffFile[]; added: number; removed: number }
  | { card: 'read'; path: string; window: ReadWindow; truncated: boolean }
  | {
      card: 'search';
      mode: 'content' | 'name';
      groups: readonly SearchGroup[];
      shown: number;
      /** The pre-cap total when the result reported one; null = capped, total unknown. */
      total: number | null;
      truncated: boolean;
      /** Matched text by `path:line` (see `matchTexts`); empty in name mode. */
      texts: ReadonlyMap<string, string>;
    }
  | { card: 'plan'; items: readonly { text: string; status: string }[]; done: number; total: number; active: number }
  | { card: 'io'; input: string | null; output: string | null }
  | { card: 'none' };

/** What `bodyShell` reads: the two cards, the card model, the raw args and the live tail. */
export interface ShellInput {
  view: ToolCallView;
  body: CardBody;
  result: ToolResultView | undefined;
  model: Pick<CardModel, 'foot'>;
  /** The result's flattened text, for cards the model cannot carry alone. */
  output: string | undefined;
  /** Live tail while the call runs (bash output so far). */
  tail: string | undefined;
  /** The call's original argument JSON. */
  args: string;
}

/**
 * Which body an expanded row draws. A structured card replaces the IN/OUT
 * fallback entirely (the harness `ToolRow` rule): only a card-less call falls
 * back to the input/output pair, and only a terminal card draws the prompt
 * banner.
 */
export function bodyShell(input: ShellInput): BodyShell {
  const { view, body, result, output, tail, args } = input;
  const terminal = (): BodyShell => {
    const command = view.card === 'terminal' ? view.command : null;
    if (result !== undefined && result.card === 'terminal' && body.kind === 'output') {
      return {
        card: 'terminal',
        command,
        output: body.text,
        exitCode: result.exitCode,
        running: false,
        pill: result.exitCode === 0 ? null : input.model.foot ?? '失败',
      };
    }
    return { card: 'terminal', command, output: tail ?? '', exitCode: undefined, running: true, pill: null };
  };
  switch (body.kind) {
    case 'diff': {
      const totals = diffTotals(body.diffs);
      return { card: 'diff', files: diffFiles(body.diffs), added: totals.added, removed: totals.removed };
    }
    case 'matches': {
      const shown = body.matches.length;
      const mode = view.card === 'search' ? view.mode : 'content';
      return {
        card: 'search',
        mode,
        groups: searchGroups(body.matches),
        shown,
        // The result card reports truncation without a pre-cap total, so a capped
        // search's total is unknown (see `searchSummary`).
        total: body.truncated ? null : shown,
        truncated: body.truncated,
        // Name-mode lines are bare paths, so there is nothing to look up.
        texts: mode === 'content' ? matchTexts(output ?? '') : new Map<string, string>(),
      };
    }
    case 'read':
      return { card: 'read', path: body.path, window: readWindow(output ?? ''), truncated: body.truncated };
    case 'plan': {
      const counts = planSummary(body.items);
      return { card: 'plan', items: body.items, done: counts.done, total: counts.total, active: counts.active };
    }
    case 'output':
      return view.card === 'terminal' ? terminal() : ioBody(args, body.text);
    case 'args':
      return view.card === 'terminal' ? terminal() : ioBody(args, null);
    case 'text':
      return ioBody(args, body.text);
    case 'none':
      return ioBody(args, output ?? null);
  }
}

/** The IN/OUT fallback card: the call's args in, its flattened result out. */
function ioBody(args: string, out: string | null): BodyShell {
  return { card: 'io', input: formatToolBody(args), output: out === '' ? null : out };
}

/** Format one argument payload for the expanded input section (harness `formatToolBody`). */
export function formatToolBody(argsRaw: string): string | null {
  if (argsRaw === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsRaw);
  } catch {
    // Mid-stream or malformed model JSON renders verbatim: it is still the truth
    // about what the model asked for.
    return argsRaw;
  }
  return JSON.stringify(parsed, null, 2) ?? argsRaw;
}

/** The leading dot a terminal card draws (`StateDot` semantics). */
export function terminalDot(shell: Extract<BodyShell, { card: 'terminal' }>): 'ongoing' | 'done' | 'error' {
  if (shell.running) return 'ongoing';
  return shell.exitCode === 0 ? 'done' : 'error';
}

/** The row's leading dot, per card state; null = keep the tool glyph. */
export function rowDot(state: CardModel['state']): 'ongoing' | 'idle' | 'error' | null {
  // The harness keeps the tool glyph on a settled ok row (the summary carries the
  // verdict); only the three signal-bearing states take over the leading box.
  switch (state) {
    case 'running':
      return 'ongoing';
    case 'stale':
      return 'idle';
    case 'fail':
      return 'error';
    case 'ok':
      return null;
  }
}

/** Visually hidden run-state label for a row (`row.*` copy, harness verbatim). */
export function rowStatusLabel(state: CardModel['state']): string | null {
  switch (state) {
    case 'running':
      return '运行中';
    case 'fail':
      return '失败';
    case 'stale':
      return '已停止';
    case 'ok':
      return null;
  }
}