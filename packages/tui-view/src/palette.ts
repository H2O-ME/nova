/** Color injection point: tests pass plainPalette for assertion-safe strings. */

export interface Palette {
  dim(text: string): string;
  cyan(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  red(text: string): string;
  blue(text: string): string;
  magenta(text: string): string;
  bold(text: string): string;
  inverse(text: string): string;
}

const ansi =
  (code: string) =>
  (text: string): string =>
    `\x1b[${code}m${text}\x1b[0m`;

export const palette: Palette = {
  dim: ansi('2'),
  cyan: ansi('36'),
  green: ansi('32'),
  yellow: ansi('33'),
  red: ansi('31'),
  blue: ansi('34'),
  magenta: ansi('35'),
  bold: ansi('1'),
  inverse: ansi('7'),
};

/** Style-free palette for piped output and deterministic tests. */
export const plainPalette: Palette = {
  dim: (text) => text,
  cyan: (text) => text,
  green: (text) => text,
  yellow: (text) => text,
  red: (text) => text,
  blue: (text) => text,
  magenta: (text) => text,
  bold: (text) => text,
  inverse: (text) => text,
};
