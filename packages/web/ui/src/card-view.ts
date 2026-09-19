/**
 * The tool card's decision logic, as a pure function (M11 批3): view + result
 * in, a render model out. `ToolCard.tsx` is then a dumb projection — all the
 * "which card, which headline, did it fail, what's the footnote" reasoning
 * lives here, where it can be tested without a DOM.
 *
 * This is the half of the presentation contract that belongs to the surface:
 * the host resolves *what the call means* (`view.card`), and this file decides
 * *how to say it* — Chinese labels, verdict glyphs, footnote wording. A card
 * this file has never seen still renders, because every branch either matches
 * a known card or falls through to the card's own fields.
 */
import type { FileDiff, ToolCallView, ToolResultView } from './types.js';

export type CardBody =
  | { kind: 'none' }
  /** The call's raw args (no result yet — show what was asked for). */
  | { kind: 'args'; text: string }
  | { kind: 'output'; text: string }
  | { kind: 'diff'; diffs: readonly FileDiff[] }
  | { kind: 'matches'; matches: readonly { path: string; line?: number }[]; truncated: boolean }
  | { kind: 'read'; path: string; lineCount: number; truncated: boolean }
  | { kind: 'plan'; items: readonly { text: string; status: string }[] }
  | { kind: 'text'; text: string };

export interface CardModel {
  state: 'running' | 'stale' | 'ok' | 'fail';
  /** The call's subject, already in the surface's own words. */
  headline: string;
  /** Render the headline as monospace code (commands, paths). */
  mono: boolean;
  /** Secondary operand shown next to the headline. */
  subtitle?: string;
  body: CardBody;
  /** One status line under the body (exit code, truncation, file count). */
  foot?: string;
  footTone?: 'ok' | 'fail' | 'muted';
}

export interface CardInput {
  name: string;
  args: string;
  view: ToolCallView;
  result: ToolResultView | undefined;
  /** Nothing is running: an unfinished call is a leftover, not in flight. */
  idle: boolean;
}

export function toolCardModel(input: CardInput): CardModel {
  const { view, result, idle } = input;
  const state: CardModel['state'] =
    result === undefined ? (idle ? 'stale' : 'running') : resultOk(result) ? 'ok' : 'fail';
  const head = headline(view, input.name);
  if (result === undefined) {
    return { state, ...head, body: { kind: 'args', text: oneLine(input.args) } };
  }
  return { state, ...head, ...bodyOf(result) };
}

/** Did the call succeed? Each card answers with the field it owns. */
function resultOk(view: ToolResultView): boolean {
  switch (view.card) {
    case 'generic':
      return view.ok;
    case 'terminal':
      return view.exitCode === 0;
    case 'diff':
      return view.ok;
    // Search/read/plan cards carry no failure channel of their own: a search
    // with no matches or an empty plan is a *successful* call.
    case 'search':
    case 'read':
    case 'plan':
      return true;
  }
}

/** Headline: what this call is about, per call card. */
function headline(view: ToolCallView, name: string): Pick<CardModel, 'headline' | 'mono' | 'subtitle'> {
  switch (view.card) {
    case 'terminal':
      return { headline: `$ ${view.command}`, mono: true };
    case 'diff':
      return { headline: diffTitle(view.diffs), mono: false };
    case 'search':
      return {
        headline: view.query,
        mono: true,
        subtitle: view.mode === 'content' ? '搜索内容' : '搜索文件名',
      };
    case 'generic':
      return {
        headline: view.title,
        mono: false,
        subtitle: view.subtitle === undefined ? toolKindLabel(view.kind, name) : view.subtitle,
      };
  }
}

/** The part of the model a result card determines: its body, and a footnote if it has one. */
type ResultPart = Pick<CardModel, 'body'> & Partial<Pick<CardModel, 'foot' | 'footTone'>>;

/** Body + footnote: what the call produced, per result card. */
function bodyOf(view: ToolResultView): ResultPart {
  switch (view.card) {
    case 'generic':
      return { body: { kind: 'text', text: view.text }, ...(view.ok ? {} : { foot: '失败', footTone: 'fail' as const }) };
    case 'terminal':
      return {
        body: { kind: 'output', text: view.output },
        foot: exitNote(view.exitCode, view.droppedBytes),
        footTone: view.exitCode === 0 ? ('muted' as const) : ('fail' as const),
      };
    case 'diff':
      return {
        body: { kind: 'diff', diffs: view.diffs },
        ...(view.ok ? {} : { foot: '改动未完成', footTone: 'fail' as const }),
      };
    case 'search':
      return view.matches.length === 0
        ? { body: { kind: 'text', text: '无匹配' } }
        : {
            body: { kind: 'matches', matches: view.matches, truncated: view.truncated },
            ...(view.truncated ? { foot: `结果被截断，共 ${view.matches.length}+ 处`, footTone: 'muted' as const } : {}),
          };
    case 'read':
      return {
        body: { kind: 'read', path: view.path, lineCount: view.lineCount, truncated: view.truncated },
        ...(view.truncated ? { foot: '仅返回片段', footTone: 'muted' as const } : {}),
      };
    case 'plan':
      return { body: { kind: 'plan', items: view.items } };
  }
}

function exitNote(exitCode: number | null, droppedBytes: number | undefined): string {
  const exit = exitCode === null ? '未退出（中断/超时）' : `退出码 ${exitCode}`;
  return droppedBytes !== undefined && droppedBytes > 0 ? `${exit} · 省略 ${humanBytes(droppedBytes)}` : exit;
}

function diffTitle(diffs: readonly FileDiff[]): string {
  const first = diffs[0];
  if (first === undefined) return '文件改动';
  return diffs.length === 1 ? first.path : `${first.path} 等 ${diffs.length} 个文件`;
}

/**
 * A generic card's tool kind as a word. The kind is core's vocabulary; the
 * word is this surface's — and an unrecognized kind still renders as `name`.
 */
function toolKindLabel(kind: string, name: string): string {
  switch (kind) {
    case 'read':
      return `读取 ${name}`;
    case 'search':
      return `搜索 ${name}`;
    case 'edit':
      return `编辑 ${name}`;
    case 'write':
      return `写入 ${name}`;
    case 'execute':
      return `执行 ${name}`;
    case 'job':
      return `后台任务 ${name}`;
    case 'plan':
      return `更新计划 ${name}`;
    default:
      return name;
  }
}

function oneLine(args: string): string {
  const flat = args.replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}