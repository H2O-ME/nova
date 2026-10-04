/**
 * The access-tier vocabulary the composer's selector offers: the wire value plus
 * the words the user reads, in the order the selector lists them (easiest first
 * — the harness's own ordering rule for its access seat), so the control, its
 * tooltip and any test all read the same rows.
 *
 * These are the surface's words for the kernel's enum: `ApprovalMode` comes from
 * `types.ts`, and the copy describes what a run does under each tier — a tier is
 * a promise about approvals, so the hint states it rather than naming the enum.
 *
 * The EXECUTION mode is deliberately absent. Which execution modes exist, and
 * what each one means, is decided by the plugin that provides one; that plugin
 * renders its own control on its own settings page. A table here would be the
 * host keeping a vocabulary for a plugin it is not supposed to know.
 */
import type { ApprovalMode } from '../types.js';

/** One selectable mode: the wire value and its two lines of copy. */
export interface ModeOption<T extends string> {
  code: T;
  label: string;
  hint: string;
}

export const APPROVAL_MODES: readonly ModeOption<ApprovalMode>[] = [
  { code: 'read-only', label: '只读', hint: '读操作自动放行，写/执行逐次确认' },
  { code: 'auto-edit', label: '自动编辑', hint: '工作区内写入自动放行，执行仍确认' },
  { code: 'full', label: '全部放行', hint: '一切操作不再确认（信任姿态等同执行任意命令）' },
];
