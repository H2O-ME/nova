/**
 * The cards (M11 批4): composer, approval, queue lane, list panel, welcome,
 * and the hint bar — every fixed-height region of the bottom stack.
 *
 * Three rules shape all of them, and they are the ones the old TUI paid for:
 *
 *  - **One left edge and one right edge.** Every card, the status bar and the
 *    hint bar start at `CHROME_PAD_COLS` and are `chromeWidth(cols)` wide. A
 *    popup at column 0 next to a card at column 2 reads as two applications
 *    stacked, not as one screen.
 *  - **Keys live in the hint bar, nowhere else.** A card's edges carry the
 *    card's own content (the approval card's grant semantics) and nothing that
 *    says what to press; the shortcut bar knows who owns the keyboard and
 *    prints exactly that set. One place to be wrong instead of four.
 *  - **The caret is not a colour.** It is drawn as a reverse-video cell even
 *    under NO_COLOR, because the alternate screen hides the hardware cursor;
 *    and a capsule that must hold non-ASCII is drawn with a background colour
 *    rather than SGR 7, which would change the font fallback under it.
 */
import { stringWidth, styledWidth, wrapLine } from '@nova-agent/tui';
import type { ApprovalRequest, PtcMode, ToolCallView } from '@nova-agent/core';
import { CARD_CORNERS, CHROME_PAD_COLS, COMPOSER_PAD_COLS, chromeWidth } from './layout.js';
import { capsule, paint, type Palette } from './theme.js';
import { foldLabel, segments, type Composer } from './composer.js';

const LEAD = ' '.repeat(CHROME_PAD_COLS);
/** Reverse video for the caret cell; see the header — this is not colour. */
export const CARET = '\x1b[7m';
const SGR_RESET = '\x1b[0m';
/** The composer's prompt glyph. Width 1 — see the tui width table's exclusion. */
export const COMPOSER_LEAD = '❯';
const LEAD_COLS = stringWidth(`${COMPOSER_LEAD} `);

export const COMPOSER_PLACEHOLDER = '描述任务…';
/** Rows of a queued-prompt lane, header aside. */
export const QUEUE_PREVIEW_ROWS = 2;

// ------------------------------------------------------------------- geometry

/** Truncate to a display width, marking the cut. CJK-safe. */
export function fit(text: string, cols: number): string {
  if (styledWidth(text) <= cols) return text;
  const keep = Math.max(0, cols - 1);
  let width = 0;
  let out = '';
  // eslint-disable-next-line no-control-regex
  const pattern = /\x1b\[[0-9;]*m/g;
  let at = 0;
  for (;;) {
    const match = pattern.exec(text);
    const plain = match === null ? text.length : match.index;
    for (const ch of text.slice(at, plain)) {
      const w = stringWidth(ch);
      if (width + w > keep) return `${out}…`;
      out += ch;
      width += w;
    }
    if (match === null) break;
    out += match[0]!;
    at = pattern.lastIndex;
  }
  return `${out}…`;
}

/** Pad a card row to its inner width: `│content        │`. */
export function cardRow(content: string, width: number, palette: Palette): string {
  const inner = Math.max(0, width - 2);
  const pad = Math.max(0, inner - styledWidth(content));
  const edge = paint(palette, palette.border, CARD_CORNERS.v);
  return `${LEAD}${edge}${content}${' '.repeat(pad)}${edge}`;
}

/** A card's top edge, with an optional caption tucked in at its right end. */
export function cardTop(width: number, caption: string | undefined, palette: Palette): string {
  const inner = Math.max(0, width - 2);
  const edge = (text: string): string => paint(palette, palette.border, text);
  if (caption === undefined || styledWidth(caption) + 6 > inner) {
    return `${LEAD}${edge(CARD_CORNERS.topLeft + CARD_CORNERS.h.repeat(inner) + CARD_CORNERS.topRight)}`;
  }
  const run = Math.max(1, inner - styledWidth(caption) - 4);
  return `${LEAD}${edge(CARD_CORNERS.topLeft + CARD_CORNERS.h.repeat(run) + '  ')}${caption}${edge(`  ${CARD_CORNERS.topRight}`)}`;
}

/** A card's bottom edge, with the card's own footer text on the right. */
export function cardBottom(width: number, info: string | undefined, palette: Palette): string {
  const inner = Math.max(0, width - 2);
  const edge = (text: string): string => paint(palette, palette.border, text);
  if (info === undefined || styledWidth(info) + 4 > inner) {
    return `${LEAD}${edge(CARD_CORNERS.bottomLeft + CARD_CORNERS.h.repeat(inner) + CARD_CORNERS.bottomRight)}`;
  }
  const run = Math.max(1, inner - styledWidth(info) - 4);
  return `${LEAD}${edge(CARD_CORNERS.bottomLeft + CARD_CORNERS.h.repeat(run) + '  ')}${info}${edge(`  ${CARD_CORNERS.bottomRight}`)}`;
}

// ------------------------------------------------------------------ composer

export interface ComposerInput {
  cols: number;
  composer: Composer;
  palette: Palette;
  /** Bottom-edge content — a hint, never a key (keys belong to the hint bar). */
  info?: string;
}

export interface ComposerView {
  lines: string[];
  /** Row of the caret within `lines`, and its 0-based display column. */
  cursorRow: number;
  cursorCol: number;
}

export function composerCard(input: ComposerInput): ComposerView {
  const { composer, palette } = input;
  const width = chromeWidth(input.cols);
  const inner = width - 2;
  const draftWidth = Math.max(8, inner - 2 * COMPOSER_PAD_COLS - LEAD_COLS);
  const lead = `${paint(palette, palette.accent, COMPOSER_LEAD)} `;
  const lines = [cardTop(width, undefined, palette)];
  if (composer.text.length === 0) {
    // The caret keeps its own cell and a gap of air before the placeholder:
    // butted against the first character it reads as having eaten it.
    const body = `${CARET} ${SGR_RESET} ${paint(palette, palette.grayDim, COMPOSER_PLACEHOLDER)}`;
    lines.push(cardRow(`${' '.repeat(COMPOSER_PAD_COLS)}${lead}${body}`, width, palette));
    lines.push(cardBottom(width, input.info, palette));
    return { lines, cursorRow: 1, cursorCol: caretColumn(0) };
  }
  const draft = layoutDraft(composer, draftWidth);
  for (const [index, row] of draft.rows.entries()) {
    const body = renderDraftRow(row, draft.caret.row === index ? draft.caret.col : undefined, draftWidth, palette);
    lines.push(cardRow(`${' '.repeat(COMPOSER_PAD_COLS)}${lead}${body}`, width, palette));
  }
  lines.push(cardBottom(width, input.info, palette));
  return {
    lines,
    cursorRow: 1 + draft.caret.row,
    cursorCol: caretColumn(draft.caret.col),
  };
}

/** Absolute display column of a caret sitting at `col` inside the draft. */
function caretColumn(col: number): number {
  return CHROME_PAD_COLS + 1 + COMPOSER_PAD_COLS + LEAD_COLS + col;
}

interface DraftCell {
  text: string;
  width: number;
  /** A paste chip stands in for a whole fold; the caret treats it as one thing. */
  chip: boolean;
}

interface DraftRow {
  cells: DraftCell[];
  width: number;
}

interface DraftLayout {
  rows: DraftRow[];
  caret: { row: number; col: number };
}

/**
 * Lay the draft out into rows of cells, tracking where the caret lands. A fold
 * is one cell, so the caret can only ever rest on a chip's boundary — the same
 * invariant the composer's own cursor arithmetic keeps.
 */
function layoutDraft(state: Composer, width: number): DraftLayout {
  const cells: DraftCell[] = [];
  let caretCells = 0;
  let at = 0;
  for (const segment of segments(state)) {
    if (segment.kind === 'fold') {
      cells.push({ text: foldLabel(segment.fold), width: stringWidth(foldLabel(segment.fold)), chip: true });
      at = segment.fold.end;
      if (at <= state.cursor) caretCells = cells.length;
      continue;
    }
    for (const ch of segment.text) {
      cells.push({ text: ch, width: stringWidth(ch), chip: false });
      at += ch.length;
      if (at <= state.cursor) caretCells = cells.length;
    }
  }

  const rows: DraftRow[] = [];
  let row: DraftCell[] = [];
  let col = 0;
  let caret: { row: number; col: number } | undefined;
  let consumed = 0;
  for (const cell of cells) {
    if (cell.text === '\n') {
      rows.push({ cells: row, width: col });
      row = [];
      col = 0;
      consumed += 1;
      continue;
    }
    if (col + cell.width > width && row.length > 0) {
      rows.push({ cells: row, width: col });
      row = [];
      col = 0;
    }
    if (consumed === caretCells && caret === undefined) caret = { row: rows.length, col };
    row.push(cell);
    col += cell.width;
    consumed += 1;
  }
  if (row.length > 0 || rows.length === 0) rows.push({ cells: row, width: col });
  if (caret === undefined) caret = { row: rows.length - 1, col: rows[rows.length - 1]!.width };
  return { rows, caret };
}

function renderDraftRow(row: DraftRow, caretCol: number | undefined, width: number, palette: Palette): string {
  let col = 0;
  let out = '';
  for (const cell of row.cells) {
    if (caretCol !== undefined && caretCol === col) {
      out += caretCell(cell, palette);
      col += cell.width;
      continue;
    }
    out += paintCell(cell, palette);
    col += cell.width;
  }
  if (caretCol !== undefined && caretCol === col) {
    out += `${CARET} ${SGR_RESET}`;
    col += 1;
  }
  return `${out}${' '.repeat(Math.max(0, width - col))}`;
}

function paintCell(cell: DraftCell, palette: Palette): string {
  if (!cell.chip) return paint(palette, palette.text, cell.text);
  return palette.pasteBg === '' && palette.pasteFg === '' ? cell.text : `${palette.pasteBg}${palette.pasteFg}${cell.text}${palette.reset}`;
}

function caretCell(cell: DraftCell, palette: Palette): string {
  if (!cell.chip) return `${CARET}${cell.text}${SGR_RESET}`;
  // On a chip only the first cell reverses: the rest of the label stays legible
  // and the chip keeps saying "this is one thing".
  const chars = [...cell.text];
  const head = chars.shift() ?? ' ';
  return `${CARET}${head}${SGR_RESET}${paintCell({ text: chars.join(''), width: cell.width - 1, chip: true }, palette)}`;
}

// ------------------------------------------------------------------ approvals

/** The options a pending approval offers, top to bottom. */
export const APPROVAL_OPTIONS = ['allow', 'always', 'deny'] as const;
export type ApprovalChoice = (typeof APPROVAL_OPTIONS)[number];

const PERMISSION_WORDS: Record<string, string> = {
  read: '读取',
  'read-external': '外部读取',
  write: '写入',
  execute: '执行',
  network: '网络',
};

export interface ApprovalScope {
  /** The command's words, in order. */
  words: readonly string[];
  /** How many leading words an "always" grant would memorize. */
  count: number;
}

/**
 * The narrowing scope an "always" answer would carry, or `undefined` when the
 * grant is atomic. Mirrors the engine's own rule: only an execute call gets a
 * word scope, a compound command is always memorized whole, and a single-word
 * command has nothing to narrow.
 */
export function approvalScopeOf(request: ApprovalRequest, count: number): ApprovalScope | undefined {
  if (request.kind !== 'execute') return undefined;
  const command = request.call.args['command'];
  if (typeof command !== 'string') return undefined;
  if (/&&|;|\||\$\(|\n/.test(command)) return undefined;
  const words = command.trim().split(/\s+/);
  if (words.length < 2) return undefined;
  return { words, count: Math.min(Math.max(1, count), words.length) };
}

export interface ApprovalInput {
  cols: number;
  request: ApprovalRequest;
  cursor: number;
  /** Present when ←/→ can widen the grant (an execute call with room to widen). */
  scope?: ApprovalScope | undefined;
  /** Reason typed on the deny row. */
  denyReason: string;
  palette: Palette;
}

/**
 * The ask, as a card. It carries the call, the effect preview the tool declared
 * (the diff a write *will* make), the three options, and — on its bottom edge —
 * one sentence about what an "always" grant would actually remember.
 */
export function approvalCard(input: ApprovalInput): string[] {
  const { request, palette } = input;
  const width = chromeWidth(input.cols);
  const inner = width - 2;
  const bodyWidth = Math.max(8, inner - 2 * COMPOSER_PAD_COLS);
  const kind = PERMISSION_WORDS[request.kind] ?? request.kind;
  const caption = `${paint(palette, palette.warn, '!')} ${paint(palette, palette.text, '需要审批')} ${paint(palette, palette.gray, `[${kind}]`)}`;
  const lines = [cardTop(width, caption, palette)];
  const push = (content: string): void => {
    lines.push(cardRow(`${' '.repeat(COMPOSER_PAD_COLS)}${fit(content, bodyWidth)}`, width, palette));
  };
  push(callHeadline(request.view, request, palette));
  for (const raw of request.preview ?? []) {
    for (const line of wrapLine(raw, bodyWidth)) push(previewLine(line, palette));
  }
  for (const [index, option] of APPROVAL_OPTIONS.entries()) {
    push(optionRow(option, index === input.cursor, input, palette));
  }
  lines.push(cardBottom(width, approvalFooter(input, palette), palette));
  return lines;
}

function optionRow(option: ApprovalChoice, selected: boolean, input: ApprovalInput, palette: Palette): string {
  const marker = selected ? paint(palette, palette.accent, '❯') : ' ';
  const label = optionLabel(option, input, palette);
  return `${marker} ${selected ? label : paint(palette, palette.textSecondary, label)}`;
}

function optionLabel(option: ApprovalChoice, input: ApprovalInput, palette: Palette): string {
  if (option === 'allow') return '本次允许';
  if (option === 'deny') {
    const reason = input.denyReason;
    return reason.length === 0 ? '拒绝' : `拒绝：${paint(palette, palette.textSecondary, reason)}${CARET} ${SGR_RESET}`;
  }
  const scope = input.scope;
  if (scope === undefined) return '总是允许';
  const covered = scope.words.slice(0, Math.max(1, scope.count)).join(' ');
  return `总是允许 ${paint(palette, palette.gray, '·')} ${paint(palette, palette.accent, covered)}`;
}

function approvalFooter(input: ApprovalInput, palette: Palette): string {
  if (approvalOption(input.cursor) === 'always' && input.scope !== undefined) {
    return paint(palette, palette.gray, `总是允许：记住前 ${Math.max(1, input.scope.count)} 个词`);
  }
  const words = input.scope === undefined ? undefined : [...input.scope.words];
  if (approvalOption(input.cursor) === 'deny') return paint(palette, palette.gray, '附理由：模型会收到你的拒绝理由');
  return paint(palette, palette.gray, words === undefined ? '授权只对本轮有效' : '←→ 可收窄「总是允许」的范围');
}

function approvalOption(cursor: number): ApprovalChoice {
  return APPROVAL_OPTIONS[Math.min(Math.max(0, cursor), APPROVAL_OPTIONS.length - 1)]!;
}

function previewLine(line: string, palette: Palette): string {
  if (line.startsWith('-')) return paint(palette, palette.diffDeleteFg, line);
  if (line.startsWith('+')) return paint(palette, palette.diffInsertFg, line);
  return paint(palette, palette.textSecondary, line);
}

/** The call, in one line: the presentation view when the tool declared one. */
export function callHeadline(view: ToolCallView | undefined, request: ApprovalRequest, palette: Palette): string {
  if (view === undefined) {
    return `${paint(palette, palette.text, request.call.name)} ${paint(palette, palette.gray, flattenArgs(request.call.rawArgs))}`;
  }
  switch (view.card) {
    case 'terminal':
      return paint(palette, palette.command, `$ ${view.command}`);
    case 'diff':
      return paint(palette, palette.path, view.diffs.map((diff) => diff.path).join(', '));
    case 'search':
      return `${paint(palette, palette.gray, view.mode === 'content' ? '搜索内容' : '搜索文件名')} ${paint(palette, palette.text, view.query)}`;
    case 'generic': {
      const subtitle = view.subtitle === undefined || view.subtitle.length === 0 ? '' : ` ${paint(palette, palette.gray, view.subtitle)}`;
      return `${paint(palette, palette.text, view.title)}${subtitle}`;
    }
  }
}

function flattenArgs(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 159)}…` : flat;
}

// ---------------------------------------------------------------- queue lane

export interface QueueInput {
  cols: number;
  items: readonly string[];
  palette: Palette;
}

/** The running queue, above the composer: what will be sent when this turn ends. */
export function queueLane(input: QueueInput): string[] {
  if (input.items.length === 0) return [];
  const width = chromeWidth(input.cols);
  const head = `${paint(input.palette, input.palette.accent, '⧉')} ${paint(input.palette, input.palette.textSecondary, `已排队 ${input.items.length} 条`)} ${paint(input.palette, input.palette.gray, '· 本轮结束后自动发送')}`;
  const lines = [`${LEAD}${fit(head, width)}`];
  for (const item of input.items.slice(0, QUEUE_PREVIEW_ROWS)) {
    const text = item.replace(/\s+/g, ' ').trim();
    lines.push(`${LEAD}${paint(input.palette, input.palette.grayDim, fit(`  ${text}`, width))}`);
  }
  if (input.items.length > QUEUE_PREVIEW_ROWS) {
    lines.push(`${LEAD}${paint(input.palette, input.palette.grayDim, `  …还有 ${input.items.length - QUEUE_PREVIEW_ROWS} 条`)}`);
  }
  return lines;
}

// ------------------------------------------------------------------ hint bar

/** Who owns the keyboard right now — each owner gets exactly one key set. */
export type KeyboardOwner = 'composer' | 'running' | 'approval' | 'panel';

export interface HintInput {
  cols: number;
  owner: KeyboardOwner;
  palette: Palette;
  /** Tab is printed only when a mode switch is actually available. */
  canSwitchMode?: boolean;
  /** On the approval card's "always" row, when the grant can be narrowed. */
  approvalScope?: boolean;
  /** On the approval card's "deny" row. */
  denyTyping?: boolean;
  /** A panel owns the keyboard but its arrows are not the only verb. */
  panelKeys?: readonly [string, string][];
}

interface HintEntry {
  key: string;
  label: string;
}

/**
 * The shortcut bar — the only row that says what to press. Entries are dropped
 * whole from the tail when the terminal is too narrow (a half-printed key is a
 * lie, and a wrapped hint bar would eat a transcript row).
 */
export function hintBar(input: HintInput, palette: Palette): string {
  const width = chromeWidth(input.cols);
  const entries = hintEntries(input);
  let out = '';
  for (const entry of entries) {
    const text = `${paint(palette, palette.textSecondary, entry.key)} ${paint(palette, palette.gray, entry.label)}`;
    const joined = out.length === 0 ? text : `${out}${paint(palette, palette.grayDim, '  │  ')}${text}`;
    if (styledWidth(joined) > width) break;
    out = joined;
  }
  return out.length === 0 ? '' : `${LEAD}${out}`;
}

const HINTS: Record<KeyboardOwner, HintEntry[]> = {
  composer: [
    { key: 'Enter', label: '发送' },
    { key: 'Shift+Enter', label: '换行' },
    { key: '/', label: '命令' },
    { key: 'Ctrl+C', label: '退出' },
  ],
  running: [
    { key: 'Enter', label: '排队' },
    { key: 'Esc', label: '中断' },
    { key: 'PgUp/PgDn', label: '滚动' },
    { key: 'Ctrl+C', label: '中断' },
  ],
  approval: [
    { key: '↑↓', label: '选择' },
    { key: 'Enter', label: '确认' },
    { key: 'Esc', label: '拒绝' },
  ],
  panel: [
    { key: '↑↓', label: '选择' },
    { key: 'Enter', label: '确认' },
    { key: 'Esc', label: '取消' },
  ],
};

function hintEntries(input: HintInput): HintEntry[] {
  if (input.owner === 'approval') {
    const entries = [...HINTS.approval];
    if (input.approvalScope === true) entries.splice(1, 0, { key: '←→', label: '调授权范围' });
    if (input.denyTyping === true) {
      entries.splice(1, 0, { key: '打字', label: '补理由' });
      entries.splice(2, 0, { key: 'Backspace', label: '删字' });
    }
    return entries;
  }
  if (input.owner === 'panel' && input.panelKeys !== undefined) {
    return [...input.panelKeys.map(([key, label]) => ({ key, label })), ...HINTS.panel.slice(2)];
  }
  const entries = [...HINTS[input.owner]];
  if (input.owner === 'composer' && input.canSwitchMode === true) entries.splice(1, 0, { key: 'Tab', label: '模式' });
  return entries;
}

// --------------------------------------------------------------- list panel

export interface ListPanelInput {
  cols: number;
  /** Panel title, shown on the top edge. */
  title: string;
  rows: readonly { label: string; detail?: string | undefined }[];
  cursor: number;
  /** First visible row (the caller keeps the cursor inside the window). */
  offset?: number;
  /** Visible rows; the caller sizes this from the row budget. */
  maxRows: number;
  /** Bottom-edge content — the panel's own, never a key. */
  info?: string | undefined;
  palette: Palette;
}

export function listPanel(input: ListPanelInput): string[] {
  const { palette } = input;
  const width = chromeWidth(input.cols);
  const inner = width - 2;
  const bodyWidth = Math.max(8, inner - 2 * COMPOSER_PAD_COLS);
  const offset = Math.max(0, Math.min(input.offset ?? 0, Math.max(0, input.rows.length - 1)));
  const visible = input.rows.slice(offset, offset + Math.max(1, input.maxRows));
  const lines = [cardTop(width, paint(palette, palette.text, input.title), palette)];
  for (const [index, row] of visible.entries()) {
    const selected = offset + index === input.cursor;
    const marker = selected ? paint(palette, palette.accent, '❯') : ' ';
    const label = selected ? paint(palette, palette.accent, row.label) : paint(palette, palette.text, row.label);
    const detail = row.detail === undefined ? '' : ` ${paint(palette, palette.gray, row.detail)}`;
    lines.push(cardRow(`${' '.repeat(COMPOSER_PAD_COLS)}${fit(`${marker} ${label}${detail}`, bodyWidth)}`, width, palette));
  }
  if (input.rows.length > visible.length) {
    const more = paint(palette, palette.grayDim, `  ${offset + visible.length}/${input.rows.length}`);
    lines.push(cardRow(`${' '.repeat(COMPOSER_PAD_COLS)}${more}`, width, palette));
  }
  lines.push(cardBottom(width, input.info === undefined ? undefined : paint(palette, palette.gray, input.info), palette));
  return lines;
}

// -------------------------------------------------------------- welcome card

export const MODE_LABELS: Record<PtcMode, string> = { native: '普通', ptc: 'PTC', both: '混合' };

export interface WelcomeInput {
  cols: number;
  rootDir: string;
  /** Already folded against the home directory by the caller. */
  sessionsDir: string;
  skills: number;
  mode: PtcMode;
  palette: Palette;
}

/**
 * The opening card, and the only thing on screen before the first prompt. It
 * carries facts nothing else shows (where the workspace is, where sessions
 * land, how many skills loaded) plus the mode selector as a control. The
 * identity trio — model, approval, mode — is the status bar's; the card never
 * repeats it, and no key hint is printed here either.
 */
export function welcomeCard(input: WelcomeInput): string[] {
  const { palette } = input;
  const rows: string[] = [
    rowOf('工作区', paint(palette, palette.path, input.rootDir), palette),
    rowOf('会话', paint(palette, palette.gray, input.sessionsDir), palette),
    rowOf('技能', paint(palette, palette.text, `${input.skills} 个`), palette),
    rowOf('模式', modeSelector(input.mode, palette), palette),
    rowOf('沙箱', paint(palette, palette.grayDim, 'bash / PTC 可执行任意命令，重隔离请用容器'), palette),
  ];
  const inner = Math.max(...rows.map((row) => styledWidth(row))) + 2 * COMPOSER_PAD_COLS;
  const width = Math.min(chromeWidth(input.cols), inner + 2);
  // The helpers below print the shared left inset themselves, so the card's own
  // left edge lands at `pad + CHROME_PAD_COLS` — center that edge, not the row.
  const pad = Math.max(0, Math.floor((input.cols - 1 - width - CHROME_PAD_COLS) / 2));
  const lines = [`${' '.repeat(pad)}${cardTop(width, undefined, palette)}`];
  for (const row of rows) lines.push(`${' '.repeat(pad)}${cardRow(`${' '.repeat(COMPOSER_PAD_COLS)}${row}`, width, palette)}`);
  lines.push(`${' '.repeat(pad)}${cardBottom(width, undefined, palette)}`);
  return lines;
}

function rowOf(label: string, value: string, palette: Palette): string {
  const pad = Math.max(0, 8 - styledWidth(label));
  return `${paint(palette, palette.gray, label)}${' '.repeat(pad)}${value}`;
}

/**
 * `[ 普通 ] │ [ PTC  ] │ [ 混合 ]` — three equal segments, so the brackets line
 * up as a grid; the selected one carries a capsule. Selection is the capsule
 * alone: colouring the label *and* annotating the row would give three channels
 * that can disagree.
 */
export function modeSelector(mode: PtcMode, palette: Palette): string {
  const labelWidth = Math.max(...Object.values(MODE_LABELS).map((label) => styledWidth(label)));
  const parts = (Object.keys(MODE_LABELS) as PtcMode[]).map((key) => {
    const label = MODE_LABELS[key];
    const pad = labelWidth - styledWidth(label);
    const text = `[ ${label}${' '.repeat(pad)} ]`;
    if (key === mode) return capsule(palette, text);
    return paint(palette, palette.grayDim, text);
  });
  return parts.join(paint(palette, palette.border, ' │ '));
}