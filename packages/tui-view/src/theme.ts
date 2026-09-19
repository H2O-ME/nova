import { palette, plainPalette, type Palette } from './palette.js';

/**
 * 语义主题层：视图代码继续通过 Palette 的 10 个方法上色，Theme 只决定
 * 「这 10 个语义槽各自落到什么色值」。dark 有两档（批13 起）：truecolor 终端走
 * GrokNight RGB，只报 16 色的终端回落到 `palette`（引入主题层之前的原样 ANSI 值）。
 */

export type ThemeName = 'dark' | 'light' | 'plain';

export interface Theme {
  readonly name: ThemeName;
  readonly palette: Palette;
}

/** dark 的 16 色档 = 原配色板原样引用（非 truecolor 终端逐字节不变）。 */
export const darkTheme: Theme = { name: 'dark', palette };

/** plain：无色（管道输出 / NO_COLOR / 测试断言）。 */
export const plainTheme: Theme = { name: 'plain', palette: plainPalette };

const wrap = (code: string) => {
  const fn = (text: string): string => `\x1b[${code}m${text}\x1b[0m`;
  return fn;
};
const rgb = (r: number, g: number, b: number) => (text: string): string =>
  `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;

/** Open-state control codes are theme-independent (terminal control, not
 *  color); every palette variant inherits them from here. */
const control = { reset: () => '\x1b[0m', clearLine: () => '\r\x1b[2K', clearRight: () => '\x1b[0K' };

/**
 * GrokNight 规范色（M10 批13）——逐值抄自 `xai-grok-pager-render/src/theme/groknight.rs`。
 * 语义槽按 Nova 现有角色对齐：cyan=accent（`❯`/工具参数/模型名/h1）、green=成功、
 * yellow=警告、red=失败、dim=次要文本、border=结构色。
 *
 * 只报 16 色的终端**不量化**，整屏回落到原 ANSI 调色板（`palette`）：最近邻数学会把
 * `#7aa2f7`（h2 蓝）与 `#1abc9c`（h1 青）压成同一个青，等于把这套颜色的层次抹平；
 * 与 light 主题同一姿态——16 色档是手工近似的另一套值。
 */
const NIGHT = {
  dim: [108, 108, 108], // gray #6c6c6c
  cyan: [26, 188, 156], // teal #1abc9c（accent_model / md_heading_h1）
  green: [158, 206, 106], // #9ece6a（accent_success）
  yellow: [224, 175, 104], // #e0af68（command / warning）
  red: [247, 118, 142], // #f7768e（accent_error）
  blue: [122, 162, 247], // #7aa2f7（accent_system / md_heading_h2）
  magenta: [187, 154, 247], // #bb9af7（accent_assistant / thinking / running）
  border: [80, 80, 88], // prompt_border_active #505058
} as const;

export function createDarkPalette(truecolor: boolean): Palette {
  if (!truecolor) return palette;
  const slot = (k: keyof typeof NIGHT): ((text: string) => string) => {
    const [r, g, b] = NIGHT[k];
    return rgb(r, g, b);
  };
  return {
    dim: slot('dim'),
    cyan: slot('cyan'),
    green: slot('green'),
    yellow: slot('yellow'),
    red: slot('red'),
    blue: slot('blue'),
    magenta: slot('magenta'),
    bold: wrap('1'),
    inverse: wrap('7'),
    border: slot('border'),
    ...control,
  };
}

/**
 * light：亮背景终端的高对比方案。语义槽一一对应（green=成功/yellow=警告/
 * red=失败/dim=次要/cyan=accent），只把色值换成亮底可读的深色变体。
 * truecolor 可用走 24-bit；不可用回落基础 16 色近似。
 */
function createLightPalette(truecolor: boolean): Palette {
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
      border: wrap('37'), // 亮底描边用中灰（90 在浅底上等于看不见）
      ...control,
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
    border: rgb(150, 150, 150),
    ...control,
  };
}

/**
 * 主题解析单源：NO_COLOR / 非 TTY 由调用方的 caps.color 表达（false → plain）。
 * 未配置或配置 dark 一律回 dark；未知名字也回 dark（strict config schema 挡住
 * 拼错，这里只兜底）。dark 分两档：truecolor 终端走 GrokNight RGB，只报 16 色的
 * 终端逐字节保留原 ANSI 调色板（`palette` 同一实例）。
 */
export function resolvePalette(
  themeName: string | undefined,
  caps: { color: boolean; truecolor: boolean },
): Palette {
  if (!caps.color) return plainPalette;
  if (themeName === 'light') return createLightPalette(caps.truecolor);
  if (themeName === 'plain') return plainPalette;
  return createDarkPalette(caps.truecolor);
}
