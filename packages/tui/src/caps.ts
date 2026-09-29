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

/**
 * 只报 256 色（甚至什么都不报）的宿主里，这些实际吃 24-bit——按名字升回 truecolor
 * （Grok 同一张品牌表，`theme/color_support.rs:250-269`）。Windows 无条件为真：
 * ConHost 自 Win10 起就认 `38;2`，Windows Terminal 更是默认 truecolor 但**不一定**
 * 会把 COLORTERM 传下来——只靠环境变量会整屏漏回 ANSI-16。
 */
const TRUECOLOR_HOSTS =
  /(iterm|ghostty|kitty|wezterm|alacritty|rio|\bwarp\b|vscode|windows[ _]terminal|^wt$|terminator|foot|conemu|mintty)/i;

function reportsTruecolor(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  const reported = (env['COLORTERM'] ?? '').toLowerCase();
  if (reported === 'truecolor' || reported === '24bit') return true;
  if (TRUECOLOR_HOSTS.test(env['TERM_PROGRAM'] ?? '')) return true;
  return platform === 'win32';
}

export function detectCaps(
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = process.stdout.isTTY === true,
  platform: NodeJS.Platform = process.platform,
): TerminalCaps {
  const noColor = env['NO_COLOR'] !== undefined;
  const term = env['TERM'] ?? '';
  const color = isTTY && !noColor && term !== 'dumb';
  const truecolor = color && reportsTruecolor(env, platform);
  // tmux redraws the whole pane when a ?2026 block closes — synchronized
  // output inside tmux amplifies paints instead of preventing them.
  const inTmux = env['TERM_PROGRAM'] === 'tmux' || env['TMUX'] !== undefined;
  return { color, truecolor, synchronizedOutput: isTTY && term !== 'dumb' && !inTmux };
}
