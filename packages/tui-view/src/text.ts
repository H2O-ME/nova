/**
 * Small text helpers shared by popups and the splash panel: padding,
 * timestamps and the brand header.
 */

import { styledWidth } from '@nova-agent/tui';
import { approvalLabel } from './labels.js';
import type { Palette } from './palette.js';

/** Pad to display width (CJK counts 2); overlong input passes through. */
export function padDisplay(text: string, width: number): string {
  const pad = Math.max(0, width - styledWidth(text));
  return text + ' '.repeat(pad);
}

/** `09-06 14:20` stamp for session picker rows. */
export function formatStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Minimal brand header (REPL + fallback paths; the TUI uses splash.ts). */
export function banner(
  p: Palette,
  info: { model: string; approval: string; plugins: string; sessionFile: string; rootDir: string; version: string },
): void {
  const relSession = sessionRelPath(info.rootDir, info.sessionFile);
  console.log();
  console.log(`  ${p.cyan(p.bold('Nova'))} ${p.dim(`v${info.version} — 本地编码助手`)}`);
  console.log(p.dim(`  模型 ${info.model} · 审批 ${approvalLabel(info.approval)} · 插件 ${info.plugins}`));
  console.log(p.dim(`  工作区 ${info.rootDir} · 会话 ${relSession}`));
  console.log(p.dim(`  输入 / 唤起命令面板 · Ctrl+C 中断当前轮（空闲时退出）`));
  console.log();
}

function sessionRelPath(rootDir: string, file: string): string {
  const normalizedRoot = rootDir.replaceAll('\\', '/');
  const normalizedFile = file.replaceAll('\\', '/');
  return normalizedFile.startsWith(`${normalizedRoot}/`) ? normalizedFile.slice(normalizedRoot.length + 1) : file;
}
