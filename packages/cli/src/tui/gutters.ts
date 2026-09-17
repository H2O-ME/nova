/**
 * 用户/答案行的 gutter 前缀（阶段 E 出壳 tui-mode）。尾部保持开态样式
 * （BOLD 未闭合、DIM 已复位）是 wrapBlock 挂行契约的一部分，Palette 无
 * "开而不闭"原语，故原始码留在此处——轮投影（经 TurnProjector）与
 * /session 回放共用同一份。
 */
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

export const USER_GUTTER = { first: `  ${CYAN}${BOLD}❯${RESET} ${BOLD}`, rest: `    ${BOLD}` };
export const ASSISTANT_GUTTER = { first: `  ${DIM}•${RESET} `, rest: '    ' };
