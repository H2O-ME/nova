/**
 * Splash screen builder (pure). Information layers top-down:
 * destination (workspace/session) → identity (model · approval · mode) →
 * action (key hints) → skills/warnings as plain rows (long, kept out of the
 * panel so they can't blow its width). Narrow screens clamp the panel.
 */

/**
 * Trust-posture hint, always rendered (constant — no config field): bash and
 * run_code execute arbitrary commands directly on this machine with no
 * system-level sandbox; protection comes only from the approval gate and the
 * workspace realpath boundary (details: AGENTS.md §9.3). Kept to one short
 * dim line — the splash is a signpost, not a lecture.
 */
const TRUST_POSTURE_HINT = 'bash / run_code 可执行任意命令 · 无沙箱';

import { styledWidth } from '@nova-agent/tui';
import { clipPath, clipToWidth } from './clip.js';
import { approvalLabel } from './labels.js';
import type { Palette } from './palette.js';
import { codeModeLabel } from './status-view.js';
import { padDisplay } from './text.js';
import { SPLASH_MIN_INNER } from './tokens.js';
import type { PtcMode } from '@nova-agent/core';

export interface SplashInfo {
  rootDir: string;
  sessionsRoot: string;
  model: string;
  approval: string;
  codeMode: PtcMode;
  version: string;
  skills: string[];
  warnings: string[];
  cols: number;
}

export function buildSplash(p: Palette, info: SplashInfo): string[] {
  const brand = `${p.cyan(p.bold('Nova'))} ${p.dim(`v${info.version}`)}`;
  const rawRows: [string, string, boolean][] = [
    ['工作区', info.rootDir, true],
    ['会话', info.sessionsRoot, true],
    ['模型', `${info.model} · 审批 ${approvalLabel(info.approval)} · 模式 ${codeModeLabel(info.codeMode)}`, false],
    ['提示', '/ 命令面板 · Tab 切模式 · Esc 中断 · Ctrl+C×2 退出', false],
  ];

  const maxContent = Math.max(
    ...rawRows.map(([label, val]) => styledWidth(` ${padDisplay(label, 8)}${val}`) + 2),
    SPLASH_MIN_INNER,
  );
  const inner = Math.min(maxContent, Math.max(20, info.cols - 2));
  const maxValWidth = Math.max(6, inner - 2 - 9); // inner - 2 margin - 9 label width

  const rows = rawRows.map(([label, val, isPath]) => {
    const fittedVal = isPath ? clipPath(val, maxValWidth) : clipToWidth(val, maxValWidth);
    return ` ${padDisplay(label, 8)}${fittedVal}`;
  });

  const pad = (r: string): string => `${p.dim('│')} ${r}${' '.repeat(Math.max(0, inner - styledWidth(r) - 2))} ${p.dim('│')}`;
  const lines: string[] = [];
  // ASCII logotype (figlet "Nova"): pure ASCII, skipped on narrow terminals
  // where it would wrap and desync the diff renderer's mental model.
  if (info.cols >= 44) {
    for (const row of LOGOTYPE) lines.push(` ${p.cyan(row)}`);
  }
  lines.push(
    `${p.dim('╭─ ')}${brand}${p.dim(` ${'─'.repeat(Math.max(0, inner - styledWidth(brand) - 3))}╮`)}`,
    ...rows.map(pad),
    `${p.dim(`╰${'─'.repeat(inner)}╯`)}`,
  );
  lines.push(`${p.dim(`  ${clipToWidth(TRUST_POSTURE_HINT, Math.max(10, info.cols - 8))}`)}`);
  if (info.skills.length > 0) {
    lines.push(`${p.dim(`  技能 ${clipToWidth(info.skills.join('、'), Math.max(10, info.cols - 8))}`)}`);
  }
  for (const warning of info.warnings) {
    lines.push(`${p.yellow(`  ${clipToWidth(warning, Math.max(10, info.cols - 8))}`)}`);
  }
  return lines;
}

/** figlet "Nova" (standard font), 4 rows — kept narrow so 60-col terms fit. */
const LOGOTYPE = [
  ' _  __ ',
  '| |/ /___ _ __   ___ ',
  "| ' // _ \\ '_ \\ / _ \\",
  '| . \\ __/ | | | (_) |',
  '|_|\\_\\___|_| |_|\\___/',
];

// ---- startup mode selector -------------------------------------------------

export interface ModeSelectView {
  /** Highlighted row index into the MODE_OPTIONS order (native/ptc/both). */
  index: number;
  /** false when the runtime lacks type-stripping (Node < 22.19): PTC rows dim + skipped. */
  ptcAvailable: boolean;
  cols: number;
}

const MODE_OPTIONS: Array<{ mode: PtcMode; label: string; desc: string }> = [
  { mode: 'native', label: '普通', desc: '内置工具直调' },
  { mode: 'ptc', label: 'PTC', desc: '模型只见 run_code，工具以 TS 程序编排' },
  { mode: 'both', label: '混合', desc: 'run_code 与原生调用并存' },
];

export const MODE_OPTION_COUNT = MODE_OPTIONS.length;

/**
 * Next selectable row in `delta` direction, skipping PTC rows when the runtime
 * cannot support them; wraps at the ends. Pure so the skip rule is testable.
 */
export function nextModeIndex(current: number, delta: number, ptcAvailable: boolean): number {
  for (let step = 1; step <= MODE_OPTIONS.length; step++) {
    const idx = (current + delta * step + MODE_OPTIONS.length * MODE_OPTIONS.length) % MODE_OPTIONS.length;
    if (ptcAvailable || MODE_OPTIONS[idx]!.mode === 'native') return idx;
  }
  return current;
}

/**
 * The interactive startup selector, rendered as ONE transcript block above
 * the composer. The shell re-renders it on ↑↓ and collapses it to a single
 * confirmation row on Enter/Esc/first submit (bgSubagentRows-style in-place
 * rewrite — the selector never litters the transcript).
 */
export function modeSelectRows(p: Palette, v: ModeSelectView): string[] {
  const width = Math.max(20, v.cols - 2);
  const rows: string[] = [
    clipToWidth(`${p.bold('  执行模式')}${p.dim('（启动选择 · Tab 会话中随时可切）')}`, width),
  ];
  MODE_OPTIONS.forEach((option, i) => {
    const label = padDisplay(option.label, 5);
    const selectable = v.ptcAvailable || option.mode === 'native';
    const desc = selectable ? option.desc : `${option.desc}${p.dim('（需要 Node ≥ 22.19）')}`;
    const line =
      i === v.index
        ? `  ${p.cyan(p.bold(`‣ ${label}`))} ${desc}`
        : `  ${p.dim(`  ${label}`)} ${p.dim(desc)}`;
    rows.push(clipToWidth(line, width));
  });
  rows.push(clipToWidth(p.dim('  ↑↓ 选择 · Enter 确认 · Esc 保持当前 · 直接输入立即开始'), width));
  return rows;
}

/** Single collapsed confirmation row (replaces the selector block in place). */
export function modeSelectedRow(p: Palette, mode: PtcMode, cols: number): string {
  const option = MODE_OPTIONS.find((entry) => entry.mode === mode) ?? MODE_OPTIONS[0]!;
  return clipToWidth(`${p.dim('  执行模式')} ${p.cyan(option.label)} ${p.dim(`· ${option.desc} · Tab 可随时切换`)}`, Math.max(20, cols - 2));
}
