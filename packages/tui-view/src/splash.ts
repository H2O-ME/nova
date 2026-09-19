/**
 * Welcome card (pure). Grok welcome port, second pass (M10 批5b): ONE centered
 * heavy-border card owns the whole pre-start screen — destination (workspace /
 * session roots), what's loaded (skills), the execution-mode picker, and the
 * trust posture. Nothing else sits at the top of the transcript: a centered
 * card with left-aligned orphan rows underneath reads as two accidents.
 *
 * Deliberately absent: model / approval (the persistent status bar owns
 * identity — repeating it here only dilutes it) and the key hints (they moved
 * to the empty composer's placeholder row, `composerPlaceholder`, since that is
 * where the keys actually fire).
 *
 * One control per job: while the picker is live the status bar shows only the
 * applied mode, so the card's segmented row is the single place all three
 * options appear.
 */

import { styledWidth } from '@nova-agent/tui';
import { clipPath, clipToWidth } from './clip.js';
import type { Palette } from './palette.js';
import { padDisplay } from './text.js';
import { SPLASH_MIN_INNER } from './tokens.js';
import type { PtcMode } from '@nova-agent/core';

/**
 * Trust posture, rendered as a card row (constant — no config field): bash and
 * run_code execute arbitrary commands directly on this machine with no
 * system-level sandbox; protection comes only from the approval gate and the
 * workspace realpath boundary (details: AGENTS.md §9.3).
 */
const TRUST_ROW: [string, string] = ['沙箱', '无 · bash / run_code 直接执行本机命令'];

export interface WelcomeInfo {
  rootDir: string;
  sessionsRoot: string;
  /** `os.homedir()` — paths under it display as `~/…` (the tail is what you read). */
  home: string;
  version: string;
  skills: string[];
  warnings: string[];
  cols: number;
}

export interface WelcomeView extends WelcomeInfo {
  /** Applied execution mode — the card's 模式 row always reflects it. */
  codeMode: PtcMode;
  /** Present while the startup picker is live; absent once it has collapsed. */
  select?: { index: number; ptcAvailable: boolean };
}

/** Wide terminals get a centered card, not a 200-column box. */
const WELCOME_MAX_INNER = 96;

/** ' ' + the 8-col label column: every value starts this far in. */
const LABEL_CELL = 9;

/**
 * `C:\Users\me\.nova\sessions` → `~\.nova\sessions`, so the informative tail
 * survives the clip. Prefix match is case-insensitive (Windows is); a false
 * hit on a case-differing Unix path only mislabels a display row — the
 * authoritative paths are in `/session`.
 */
function abbreviateHome(text: string, home: string): string {
  const h = home.replace(/[\\/]+$/, '');
  const rest = text.slice(h.length);
  if (h.length === 0 || rest.length === 0) return text;
  if ((rest[0] !== '/' && rest[0] !== '\\') || text.slice(0, h.length).toLowerCase() !== h.toLowerCase()) return text;
  return `~${rest}`;
}

/**
 * The welcome card, `inner + 2` display columns per row. Two passes: measure
 * with the full mode row, then clip every value into the card's own column
 * budget (the mode row degrades by whole fields — see `modeValue`).
 */
export function buildWelcome(p: Palette, v: WelcomeView): string[] {
  const values: [string, string][] = [
    ['工作区', abbreviateHome(v.rootDir, v.home)],
    ['会话', abbreviateHome(v.sessionsRoot, v.home)],
  ];
  if (v.skills.length > 0) values.push(['技能', `${v.skills.length} 个 · /skill 查看`]);
  values.push(['模式', modeValue(p, v, Number.MAX_SAFE_INTEGER)]);
  values.push(TRUST_ROW);

  const brand = 'Nova';
  const ver = v.version.length > 0 ? `v${v.version}` : '';
  // 卡片宽度按**选择器在架的三种光标位与塌缩形态里最宽的那个**定：只按当前形态量，
  // 选择器收起那一刻右边框就横跳一格（居中时还整块左右挪一次）。光标位取遍 0..2 是
  // 因为尾注随待切档变长（`当前模式` vs `将切到 混合`）。
  const pickerW = Math.max(
    ...MODE_OPTIONS.map(
      (_, i) => styledWidth(modeValue(p, { ...v, select: { index: i, ptcAvailable: true } }, Number.MAX_SAFE_INTEGER)),
    ),
  );
  const content = Math.max(
    SPLASH_MIN_INNER,
    styledWidth(`╭─ ${brand} ${ver} ─╮`),
    11 + pickerW,
    ...values.map(([l, val]) => 1 + Math.max(8, styledWidth(l)) + styledWidth(val) + 2),
    ...v.warnings.map((w) => styledWidth(`⚠ ${w}`) + 2),
  );
  const inner = Math.min(content, WELCOME_MAX_INNER, Math.max(20, v.cols - 4));
  const valWidth = Math.max(6, inner - 2 - LABEL_CELL);
  const lead = ' '.repeat(Math.max(0, Math.floor((v.cols - inner - 2) / 2)));
  const row = (r: string): string =>
    `${lead}${p.border('│')} ${r}${' '.repeat(Math.max(0, inner - 2 - styledWidth(r)))} ${p.border('│')}`;
  const label = (text: string): string => ` ${padDisplay(text, 8)}`;

  const verW = styledWidth(ver);
  const brandW = styledWidth(brand);
  const withVer = verW > 0 && inner >= brandW + verW + 8;
  const dashes = Math.max(1, inner - brandW - (withVer ? verW + 6 : 5));
  const top = `${lead}${p.border('╭─ ')}${p.cyan(p.bold(brand))}${p.border(` ${'─'.repeat(dashes)} `)}`;
  const lines: string[] = [
    withVer ? `${top}${p.border(ver)}${p.border(' ─╮')}` : `${top}${p.border('─╮')}`,
  ];
  for (const [l, val] of values) {
    const fitted =
      l === '模式'
        ? modeValue(p, v, valWidth)
        : l === TRUST_ROW[0]
          ? clipToWidth(val, valWidth)
          : clipPath(val, valWidth);
    lines.push(row(`${label(l)}${fitted}`));
  }
  for (const warning of v.warnings) lines.push(row(p.yellow(clipToWidth(`⚠ ${warning}`, inner - 2))));
  lines.push(`${lead}${p.border(`╰${'─'.repeat(inner)}╯`)}`);
  return lines;
}

// ---- execution mode options ------------------------------------------------

const MODE_OPTIONS: Array<{ mode: PtcMode; label: string; desc: string }> = [
  { mode: 'native', label: '普通', desc: '内置工具直调' },
  { mode: 'ptc', label: 'PTC', desc: 'run_code 编排工具调用' },
  { mode: 'both', label: '混合', desc: 'run_code 与原生并存' },
];

export const MODE_OPTION_COUNT = MODE_OPTIONS.length;

/**
 * Next selectable segment in `delta` direction, skipping PTC rows when the runtime
 * cannot support them; wraps at the ends. Pure so the skip rule is testable.
 */
export function nextModeIndex(current: number, delta: number, ptcAvailable: boolean): number {
  for (let step = 1; step <= MODE_OPTIONS.length; step++) {
    const idx = (current + delta * step + MODE_OPTIONS.length * MODE_OPTIONS.length) % MODE_OPTIONS.length;
    if (ptcAvailable || MODE_OPTIONS[idx]!.mode === 'native') return idx;
  }
  return current;
}

function modeOption(mode: PtcMode): { mode: PtcMode; label: string; desc: string } {
  return MODE_OPTIONS.find((entry) => entry.mode === mode) ?? MODE_OPTIONS[0]!;
}

/**
 * The card's 模式 row.
 *
 * Settled (picker collapsed): the applied mode plus what it means (that is the
 * moment a description earns its width — the choice is already made). Live: a
 * segmented control where the cursor is the inverse capsule and the **applied**
 * mode carries a `•` dot inside its own brackets, and the tail names whether
 * Enter changes anything (`将切到 X` vs `当前模式`). Those three channels keep a
 * pending cursor from reading as a status bar that contradicts itself. The row
 * carries no key hints — the composer placeholder already teaches ↑↓/Enter, and
 * keeping the row short means the card is the same width live and settled (no
 * jump when the picker collapses). Narrow screens drop the whole tail.
 */
function modeValue(p: Palette, v: WelcomeView, budget: number): string {
  const current = modeOption(v.codeMode);
  const sel = v.select;
  if (sel === undefined) {
    return clipToWidth(`${p.cyan(current.label)} ${p.dim(`· ${current.desc} · Tab 可随时切换`)}`, budget);
  }
  const pending = modeOption(MODE_OPTIONS[sel.index]?.mode ?? v.codeMode);
  const state = pending.mode === v.codeMode ? '当前模式' : `将切到 ${pending.label}`;
  // 三格等宽：`普通`/`混合` 是 4 列、`PTC` 是 3 列，不补齐就是 `[ 普通 ]│[PTC]│[混合]`
  // ——一条长短不齐的锯齿，读起来像手抖而不像分段控件。
  const cellW = Math.max(...MODE_OPTIONS.map((entry) => styledWidth(entry.label)));
  const segments = MODE_OPTIONS.map((entry, i) => {
    // 已生效档用颜色标，不用字形：反色 run 会换字体回落，把 `•` 这类"宽度看上下文"
    // 的字形撑偏一格，整行的右边框就跟着错位（真机截图对照出来的）。三条通道照旧
    // 分开写——颜色=已生效、反色胶囊=光标、尾注=Enter 会不会改变。
    const label = entry.mode === v.codeMode ? p.cyan(padDisplay(entry.label, cellW)) : padDisplay(entry.label, cellW);
    const text = `[ ${label} ]`;
    return i === sel.index ? p.inverse(text) : p.dim(text);
  }).join(p.dim(' │ '));
  const note = !sel.ptcAvailable && pending.mode !== 'native' ? ' · 需 Node ≥ 22.19' : '';
  const head = `${segments} `;
  const line = head + p.dim(state + note);
  return styledWidth(line) <= budget ? line : clipToWidth(head, budget);
}
