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
  const lines: string[] = [
    `${p.dim('╭─ ')}${brand}${p.dim(` ${'─'.repeat(Math.max(0, inner - styledWidth(brand) - 3))}╮`)}`,
    ...rows.map(pad),
    `${p.dim(`╰${'─'.repeat(inner)}╯`)}`,
  ];
  lines.push(`${p.dim(`  ${clipToWidth(TRUST_POSTURE_HINT, Math.max(10, info.cols - 8))}`)}`);
  if (info.skills.length > 0) {
    lines.push(`${p.dim(`  技能 ${clipToWidth(info.skills.join('、'), Math.max(10, info.cols - 8))}`)}`);
  }
  for (const warning of info.warnings) {
    lines.push(`${p.yellow(`  ${clipToWidth(warning, Math.max(10, info.cols - 8))}`)}`);
  }
  return lines;
}
