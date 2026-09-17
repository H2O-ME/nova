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
  /**
   * Open-state control primitives for the line-oriented runners (REPL spinner,
   * progress rows): the no-op string on plainPalette means a non-color or
   * NO_COLOR stream simply omits the control sequence instead of emitting a
   * raw escape code that the host might render as garbage. The line-oriented
   * runners route every erase/carriage-return/reset through these so the
   * "colorless ⇒ silent" contract holds for control codes too.
   */
  /** Reset all attributes (`\x1b[0m`). */
  reset(): string;
  /** Carriage return + erase entire line (`\r\x1b[2K`). */
  clearLine(): string;
  /** Erase to end of line (`\x1b[0K`). */
  clearRight(): string;
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
  reset: () => '\x1b[0m',
  clearLine: () => '\r\x1b[2K',
  clearRight: () => '\x1b[0K',
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
  // Plain streams (NO_COLOR / piped / non-TTY) must stay silent: the line-
  // oriented runners gate visual progress on `useColor`, so a stray erase or
  // reset here would land as a raw escape in the captured output.
  reset: () => '',
  clearLine: () => '',
  clearRight: () => '',
};
