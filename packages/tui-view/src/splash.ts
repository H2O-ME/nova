/**
 * Splash screen builder (pure). Information layers top-down:
 * destination (workspace/session) → identity (model · approval · mode) →
 * action (key hints) → skills/warnings as plain rows (long, kept out of the
 * panel so they can't blow its width). Narrow screens clamp the panel.
 */

import { styledWidth } from '@nova-agent/tui';
import { approvalLabel } from './labels.js';
import type { Palette } from './palette.js';
import { codeModeLabel } from './status-view.js';
import { padDisplay } from './text.js';
import { SPLASH_MIN_INNER } from './tokens.js';
import type { PtcMode } from '@nova-agent/plugins';

export interface SplashInfo {
  rootDir: string;
  sessionsRoot: string;
  model: string;
  approval: string;
  codeMode: PtcMode;
  skills: string[];
  warnings: string[];
  cols: number;
}

export function buildSplash(p: Palette, info: SplashInfo): string[] {
  const brand = `${p.cyan(p.bold('Nova'))} ${p.dim('v0.1.0')}`;
  const row = (label: string, value: string): string => ` ${padDisplay(label, 8)}${value}`;
  const rows = [
    row('工作区', info.rootDir),
    row('会话', info.sessionsRoot),
    row('模型', `${info.model} · 审批 ${approvalLabel(info.approval)} · 模式 ${codeModeLabel(info.codeMode)}`),
    row('提示', '/ 命令面板 · Tab 切模式 · Esc 中断 · Ctrl+C×2 退出'),
  ];
  const contentWidth = Math.max(...rows.map((r) => styledWidth(r) + 2), SPLASH_MIN_INNER);
  const inner = Math.min(contentWidth, Math.max(10, info.cols - 2));
  const pad = (r: string): string => `${p.dim('│')} ${r}${' '.repeat(Math.max(0, inner - styledWidth(r) - 2))} ${p.dim('│')}`;
  const lines: string[] = [
    `${p.dim('╭─ ')}${brand}${p.dim(` ${'─'.repeat(Math.max(0, inner - styledWidth(brand) - 3))}╮`)}`,
    ...rows.map(pad),
    `${p.dim(`╰${'─'.repeat(inner)}╯`)}`,
  ];
  if (info.skills.length > 0) {
    lines.push(`${p.dim(`  技能 ${info.skills.join('、')}`)}`);
  }
  for (const warning of info.warnings) {
    lines.push(`${p.yellow(`  ${warning}`)}`);
  }
  return lines;
}
