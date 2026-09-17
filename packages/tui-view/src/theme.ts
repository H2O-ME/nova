import { palette, plainPalette, type Palette } from './palette.js';

/**
 * 语义主题层：视图代码继续通过 Palette 的 9 个方法上色，Theme 只决定
 * 「这 9 个语义槽各自落到什么色值」。默认 dark 主题 = 原配色板原样平移
 * ——默认观感字节不变（tui-design 红线：语义不重排，只换绑定的色值）。
 */

export type ThemeName = 'dark' | 'light' | 'plain';

export interface Theme {
  readonly name: ThemeName;
  readonly palette: Palette;
}

/** dark = 原配色板原样引用：dark 下输出与引入主题层之前逐字节一致。 */
export const darkTheme: Theme = { name: 'dark', palette };

/** plain：无色（管道输出 / NO_COLOR / 测试断言）。 */
export const plainTheme: Theme = { name: 'plain', palette: plainPalette };

const wrap = (code: string) => {
  const fn = (text: string): string => `\x1b[${code}m${text}\x1b[0m`;
  return fn;
};
const rgb = (r: number, g: number, b: number) => (text: string): string =>
  `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;

/**
 * light：亮背景终端的高对比方案。语义槽一一对应（green=成功/yellow=警告/
 * red=失败/dim=次要/cyan=accent），只把色值换成亮底可读的深色变体。
 * truecolor 可用走 24-bit；不可用回落基础 16 色近似。
 */
function createLightPalette(truecolor: boolean): Palette {
  // Open-state control codes are theme-independent (terminal control, not
  // color); inherit them from the base palette.
  const base = { reset: () => '\x1b[0m', clearLine: () => '\r\x1b[2K', clearRight: () => '\x1b[0K' };
  if (!truecolor) {
    return {
      dim: wrap('2'),
      cyan: wrap('34'),
      green: wrap('32'),
      yellow: wrap('33'),
      red: wrap('31'),
      blue: wrap('34'),
      magenta: wrap('35'),
      bold: wrap('1'),
      inverse: wrap('7'),
      ...base,
    };
  }
  return {
    dim: wrap('2'),
    cyan: rgb(0, 95, 175),
    green: rgb(0, 135, 0),
    yellow: rgb(175, 95, 0),
    red: rgb(175, 0, 0),
    blue: rgb(0, 0, 175),
    magenta: rgb(175, 0, 175),
    bold: wrap('1'),
    inverse: wrap('7'),
    ...base,
  };
}

/**
 * 主题解析单源：NO_COLOR / 非 TTY 由调用方的 caps.color 表达（false → plain）。
 * 未配置或配置 dark 一律回 darkTheme（默认观感不变）；未知名字也回 dark
 * （strict config schema 挡住拼错，这里只兜底）。
 */
export function resolvePalette(
  themeName: string | undefined,
  caps: { color: boolean; truecolor: boolean },
): Palette {
  if (!caps.color) return plainPalette;
  if (themeName === 'light') return createLightPalette(caps.truecolor);
  if (themeName === 'plain') return plainPalette;
  return darkTheme.palette;
}
