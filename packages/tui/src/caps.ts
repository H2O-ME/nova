/**
 * 终端能力探测（启动时一次）：色彩与输出同步能力决定主题后端选择。
 * NO_COLOR（https://no-color.org/）与 TERM=dumb 强制无色；COLORTERM 报告
 * truecolor；?2026 是 DEC 私有模式，不支持的终端会忽略而非误执行，因此
 * synchronizedOutput 在 TTY 下默认启用。
 */
export interface TerminalCaps {
  color: boolean;
  truecolor: boolean;
  synchronizedOutput: boolean;
}

export function detectCaps(
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = process.stdout.isTTY === true,
): TerminalCaps {
  const noColor = env['NO_COLOR'] !== undefined;
  const term = env['TERM'] ?? '';
  const color = isTTY && !noColor && term !== 'dumb';
  const truecolor = color && (env['COLORTERM'] === 'truecolor' || env['COLORTERM'] === '24bit');
  // tmux redraws the whole pane when a ?2026 block closes — synchronized
  // output inside tmux amplifies paints instead of preventing them.
  const inTmux = env['TERM_PROGRAM'] === 'tmux' || env['TMUX'] !== undefined;
  return { color, truecolor, synchronizedOutput: isTTY && term !== 'dumb' && !inTmux };
}
