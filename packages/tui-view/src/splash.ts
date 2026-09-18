/**
 * Splash screen builder (pure). Grok welcome port (M10): the panel carries
 * ONLY what the status bar can't show — the destination (workspace / session
 * roots) — as a centered hero box. Identity (model · approval · mode) lives
 * in the persistent status bar and is never repeated here; the action hints
 * that used to occupy a panel row moved into the composer placeholder
 * (`composerPlaceholder`), because that is where the action actually is.
 * The startup mode selector is a single-line segmented control, not a list.
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
import type { Palette } from './palette.js';
import { padDisplay } from './text.js';
import { SPLASH_MIN_INNER } from './tokens.js';
import type { PtcMode } from '@nova-agent/core';

export interface SplashInfo {
  rootDir: string;
  sessionsRoot: string;
  /** `os.homedir()` — paths under it display as `~/…` (the tail is what you read). */
  home: string;
  version: string;
  skills: string[];
  warnings: string[];
  cols: number;
}

/** Wide terminals get a centered hero, not a 200-column box. */
const SPLASH_MAX_INNER = 100;

/**
 * `C:\Users\me\.nova\sessions` → `~\.nova\sessions`, so the informative tail
 * survives the panel clip. Prefix match is case-insensitive (Windows is); a
 * false hit on a case-differing Unix path only mislabels a display row — the
 * authoritative paths are in `/session`.
 */
function abbreviateHome(text: string, home: string): string {
  const h = home.replace(/[\\/]+$/, '');
  const rest = text.slice(h.length);
  if (h.length === 0 || rest.length === 0) return text;
  if ((rest[0] !== '/' && rest[0] !== '\\') || text.slice(0, h.length).toLowerCase() !== h.toLowerCase()) return text;
  return `~${rest}`;
}

export function buildSplash(p: Palette, info: SplashInfo): string[] {
  const rows: [string, string][] = [
    ['工作区', abbreviateHome(info.rootDir, info.home)],
    ['会话', abbreviateHome(info.sessionsRoot, info.home)],
  ];
  const content = Math.max(
    SPLASH_MIN_INNER,
    styledWidth(`Nova v${info.version}`) + 6,
    // +2 for the panel's own 1-col inner margins, so a row never overflows.
    ...rows.map(([label, val]) => styledWidth(` ${padDisplay(label, 8)}${val}`) + 2),
  );
  const inner = Math.min(content, SPLASH_MAX_INNER, Math.max(20, info.cols - 4));
  const brand = clipToWidth(`${p.cyan(p.bold('Nova'))} ${p.dim(`v${info.version}`)}`, Math.max(4, inner - 4));
  // Symmetric 1-col margins inside the border, so every row of the panel is
  // exactly `inner + 2` display columns wide.
  const pad = (r: string): string => `${p.dim('│')} ${r}${' '.repeat(Math.max(0, inner - styledWidth(r) - 2))} ${p.dim('│')}`;
  const maxValWidth = Math.max(6, inner - 2 - 9); // inner - 2 margin - 9 label width
  const lead = ' '.repeat(Math.max(0, Math.floor((info.cols - inner - 2) / 2)));
  const lines: string[] = [
    `${lead}${p.dim('╭─ ')}${brand}${p.dim(` ${'─'.repeat(Math.max(0, inner - styledWidth(brand) - 3))}╮`)}`,
    ...rows.map(([label, val]) => `${lead}${pad(` ${padDisplay(label, 8)}${clipPath(val, maxValWidth)}`)}`),
    `${lead}${p.dim(`╰${'─'.repeat(inner)}╯`)}`,
    p.dim(`  ${clipToWidth(TRUST_POSTURE_HINT, Math.max(10, info.cols - 8))}`),
  ];
  if (info.skills.length > 0) {
    lines.push(p.dim(`  技能 ${clipToWidth(info.skills.join('、'), Math.max(10, info.cols - 8))}`));
  }
  for (const warning of info.warnings) {
    lines.push(p.yellow(`  ${clipToWidth(warning, Math.max(10, info.cols - 8))}`));
  }
  return lines;
}

// ---- startup mode selector (single-line segmented control) -----------------

export interface ModeSelectView {
  /** Highlighted segment index into the MODE_OPTIONS order (native/ptc/both). */
  index: number;
  /** false when the runtime lacks type-stripping (Node < 22.19): PTC rows dim + skipped. */
  ptcAvailable: boolean;
  cols: number;
}

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

/**
 * The interactive startup selector: ONE transcript row, Grok's segmented
 * control shape — the highlighted option as an inverse capsule, the others dim
 * in their own brackets, so ↑↓ reads as "the capsule moves" instead of a list
 * redrawing. The shell rewrites this one row in place and collapses it to
 * `modeSelectedRow` on Enter/Esc/first submit. Narrow screens drop whole
 * trailing fields (description, then the keys that no longer fit) — never
 * mid-word.
 */
export function modeSelectRows(p: Palette, v: ModeSelectView): string[] {
  const width = Math.max(20, v.cols - 2);
  const segments = MODE_OPTIONS.map((option, i) =>
    i === v.index ? p.inverse(`[ ${option.label} ]`) : p.dim(`[${option.label}]`),
  ).join(p.dim('│'));
  const current = MODE_OPTIONS[v.index] ?? MODE_OPTIONS[0]!;
  const runtimeNote = !v.ptcAvailable && current.mode !== 'native' ? p.dim(' · 需 Node ≥ 22.19') : '';
  const head = `  ${p.bold('执行模式')} ${segments}`;
  for (const tail of [
    p.dim(` · ${current.desc} · ↑↓ 选择 · Enter 确认 · Esc 保持当前`) + runtimeNote,
    p.dim(` · ↑↓ 选择 · Enter 确认 · Esc 保持当前`) + runtimeNote,
    p.dim(` · ↑↓ 选择 · Enter 确认`) + runtimeNote,
  ]) {
    const row = head + tail;
    if (styledWidth(row) <= width) return [row];
  }
  return [clipToWidth(`${head}${p.dim(' · Enter 确认')}`, width)];
}

/** Single collapsed confirmation row (replaces the selector block in place). */
export function modeSelectedRow(p: Palette, mode: PtcMode, cols: number): string {
  const option = MODE_OPTIONS.find((entry) => entry.mode === mode) ?? MODE_OPTIONS[0]!;
  return clipToWidth(
    `  ${p.dim('执行模式')} ${p.cyan(`[${option.label}]`)} ${p.dim(`· ${option.desc} · Tab 可随时切换`)}`,
    Math.max(20, cols - 2),
  );
}
