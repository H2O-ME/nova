/**
 * The two mode vocabularies the composer's selectors offer: the wire value
 * plus the words the user reads. One table each, in the order the selector
 * lists them (easiest first — the harness's own ordering rule for its access
 * seat), so the control, its tooltip and any test all read the same rows.
 *
 * These are the surface's words for the kernel's enums: `ApprovalMode` and
 * `PtcMode` come from `types.ts`, and the copy describes what a run does under
 * each one — a tier is a promise about approvals, so the hint states it rather
 * than naming the enum.
 */
import type { ApprovalMode, PtcMode } from '../types.js';

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

export const CODE_MODES: readonly ModeOption<PtcMode>[] = [
  { code: 'native', label: '普通', hint: '只暴露原生工具调用' },
  { code: 'ptc', label: 'PTC', hint: '只暴露 run_code（模型写程序批量调用工具）' },
  { code: 'both', label: '混合', hint: '原生工具与 run_code 同时可用' },
];