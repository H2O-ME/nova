/**
 * The palette (M11 批4): GrokNight's RGB table in truecolor terminals, the
 * project's own ANSI-16 colours elsewhere, and nothing at all under NO_COLOR.
 *
 * Slot names are grok's own semantic names, because they encode decisions the
 * old TUI kept re-deriving: a *thinking* block is magenta, an *assistant* block
 * magenta too, a *tool* row grey, a *system/notice* line blue, and error /
 * success / running are their own slots. Colouring a line therefore means
 * naming what it is, not picking a colour.
 *
 * Two rules carried over from the terminal work that earned them:
 *  - **Border is a structural colour, not a theme colour.** A bare box-drawing
 *    character lands at the terminal's default intensity and reads as cheap
 *    next to coloured content, so `border` is its own slot and never `dim`.
 *  - **Never put non-ASCII glyphs inside a reverse-video run.** SGR 7 changes
 *    the font fallback, and a glyph whose width is context-dependent can walk
 *    one column past what `styledWidth` computed — offline arithmetic stays
 *    right while the real terminal's border drifts. Cards keep ASCII inside
 *    reversed cells and say everything else with colour.
 */

/** SGR fragments plus grok's semantic slots. */
export interface Palette {
  reset: string;
  bold: string;
  dim: string;
  /** Primary body text. */
  text: string;
  /** Secondary text: labels, meta, phase words. */
  textSecondary: string;
  gray: string;
  grayBright: string;
  grayDim: string;
  /** Brand accent (grok's `accent_model`): prompts, focus, brand chrome. */
  accent: string;
  accentUser: string;
  accentAssistant: string;
  accentThinking: string;
  accentTool: string;
  accentSystem: string;
  accentSuccess: string;
  accentError: string;
  accentRunning: string;
  accentSkill: string;
  accentPlan: string;
  /** Structural lines: card borders, separators. */
  border: string;
  borderActive: string;
  selectionBorder: string;
  /** Semantic foregrounds. */
  command: string;
  path: string;
  running: string;
  warning: string;
  ok: string;
  warn: string;
  fail: string;
  diffInsertBg: string;
  diffInsertFg: string;
  diffDeleteBg: string;
  diffDeleteFg: string;
  pasteBg: string;
  pasteFg: string;
  pasteDim: string;
  /**
   * A selected segment's capsule: background plus its own foreground. Colour,
   * never reverse video — SGR 7 changes the terminal's font fallback, so a
   * capsule built that way can only ever hold ASCII (see the file header).
   */
  capsuleBg: string;
  capsuleFg: string;
  /**
   * The theme's background, as the colour a rail row blends its wave *toward*:
   * dark and light are not a coat of paint over one table, so the blend target
   * has to move with the theme.
   */
  bg: string;
  mdHeading1: string;
  mdHeading2: string;
  mdHeading3: string;
  mdCode: string;
  mdMuted: string;
  link: string;
  /** Context-gauge zone colours, in legend order. */
  zonePrompt: string;
  zoneSchema: string;
  zoneFragment: string;
  zoneSkills: string;
  zoneMessages: string;
}

const sgr = (code: string): string => `\x1b[${code}m`;
const fg = (hex: string): string => {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return sgr(`38;2;${r};${g};${b}`);
};

/** GrokNight (grok's default theme), by semantic slot. */
const GROKNIGHT = {
  text: '#e1e1e1',
  textSecondary: '#c8c8c8',
  gray: '#6c6c6c',
  grayBright: '#787878',
  grayDim: '#585858',
  accent: '#1abc9c',
  accentUser: '#c8c8c8',
  accentAssistant: '#bb9af7',
  accentThinking: '#bb9af7',
  accentTool: '#787878',
  accentSystem: '#7aa2f7',
  accentSuccess: '#9ece6a',
  accentError: '#f7768e',
  accentRunning: '#7dcfff',
  accentSkill: '#7aa2f7',
  accentPlan: '#ffdb8d',
  border: '#323237',
  borderActive: '#505058',
  selectionBorder: '#3c3c41',
  command: '#e0af68',
  path: '#ff9e64',
  running: '#7dcfff',
  warning: '#e0af68',
  ok: '#9ece6a',
  warn: '#e0af68',
  fail: '#f7768e',
  diffInsertBg: '#063806',
  diffInsertFg: '#9ece6a',
  diffDeleteBg: '#420e14',
  diffDeleteFg: '#f7768e',
  pasteBg: '#111111',
  pasteFg: '#c8c8c8',
  pasteDim: '#414141',
  capsuleBg: '#3a3a42',
  capsuleFg: '#e1e1e1',
  mdHeading1: '#1abc9c',
  mdHeading2: '#7aa2f7',
  mdHeading3: '#9d7cd8',
  mdCode: '#3a95ab',
  mdMuted: '#6c6c6c',
  link: '#7aa6da',
  zonePrompt: '#1abc9c',
  zoneSchema: '#9ece6a',
  zoneFragment: '#7aa2f7',
  zoneSkills: '#bb9af7',
  zoneMessages: '#e0af68',
  bg: '#141414',
} as const;

/**
 * The light theme, on the same semantic slots: a daylight counterpart to
 * GrokNight rather than a second design. The neutrals invert, the brand teal
 * stays the accent, and every semantic slot keeps its meaning — a card that
 * says "success is green" reads the same in both.
 */
const NOVADAY = {
  text: '#1f2328',
  textSecondary: '#3d444d',
  gray: '#6e7781',
  grayBright: '#57606a',
  grayDim: '#8c959f',
  accent: '#0f766e',
  accentUser: '#24292f',
  accentAssistant: '#7c3aed',
  accentThinking: '#7c3aed',
  accentTool: '#57606a',
  accentSystem: '#0969da',
  accentSuccess: '#1a7f37',
  accentError: '#cf222e',
  accentRunning: '#0969da',
  accentSkill: '#0969da',
  accentPlan: '#9a6700',
  border: '#d0d7de',
  borderActive: '#afb8c1',
  selectionBorder: '#c8d1d9',
  command: '#9a6700',
  path: '#bc4c00',
  running: '#0969da',
  warning: '#9a6700',
  ok: '#1a7f37',
  warn: '#9a6700',
  fail: '#cf222e',
  diffInsertBg: '#dafbe1',
  diffInsertFg: '#1a7f37',
  diffDeleteBg: '#ffebe9',
  diffDeleteFg: '#cf222e',
  pasteBg: '#f6f8fa',
  pasteFg: '#24292f',
  pasteDim: '#d0d7de',
  capsuleBg: '#d0d7de',
  capsuleFg: '#1f2328',
  mdHeading1: '#0f766e',
  mdHeading2: '#0969da',
  mdHeading3: '#8250df',
  mdCode: '#0550ae',
  mdMuted: '#6e7781',
  link: '#0969da',
  zonePrompt: '#0f766e',
  zoneSchema: '#1a7f37',
  zoneFragment: '#0969da',
  zoneSkills: '#8250df',
  zoneMessages: '#9a6700',
  bg: '#ffffff',
} as const satisfies Record<Slot, string>;

type Slot = keyof typeof GROKNIGHT;

/**
 * ANSI-16 mapping for terminals that report no truecolor support. Grok's teal
 * brand accent has no 16-colour equivalent, so it becomes cyan; magenta/purple
 * collapse onto the same slot, which is why the slots are named rather than
 * numbered — the mapping is a decision, not an accident.
 */
const ANSI16: Record<Slot, string> = {
  text: sgr('37'),
  textSecondary: sgr('37'),
  gray: sgr('90'),
  grayBright: sgr('90'),
  grayDim: sgr('90'),
  accent: sgr('36'),
  accentUser: sgr('37'),
  accentAssistant: sgr('35'),
  accentThinking: sgr('35'),
  accentTool: sgr('90'),
  accentSystem: sgr('34'),
  accentSuccess: sgr('32'),
  accentError: sgr('31'),
  accentRunning: sgr('36'),
  accentSkill: sgr('34'),
  accentPlan: sgr('33'),
  border: sgr('90'),
  borderActive: sgr('90'),
  selectionBorder: sgr('90'),
  command: sgr('33'),
  path: sgr('33'),
  running: sgr('36'),
  warning: sgr('33'),
  ok: sgr('32'),
  warn: sgr('33'),
  fail: sgr('31'),
  diffInsertBg: '',
  diffInsertFg: sgr('32'),
  diffDeleteBg: '',
  diffDeleteFg: sgr('31'),
  pasteBg: '',
  pasteFg: sgr('37'),
  pasteDim: sgr('90'),
  capsuleBg: sgr('100'),
  capsuleFg: sgr('97'),
  bg: '',
  mdHeading1: sgr('36'),
  mdHeading2: sgr('34'),
  mdHeading3: sgr('35'),
  mdCode: sgr('36'),
  mdMuted: sgr('90'),
  link: sgr('34'),
  zonePrompt: sgr('36'),
  zoneSchema: sgr('32'),
  zoneFragment: sgr('34'),
  zoneSkills: sgr('35'),
  zoneMessages: sgr('33'),
};

/**
 * A 16-colour terminal cannot express a light background, but it can express
 * the darker foregrounds a light one needs: only the neutral slots change, and
 * everything semantic keeps the mapping that survives on either background.
 */
const ANSI16_LIGHT: Record<Slot, string> = {
  ...ANSI16,
  text: sgr('30'),
  textSecondary: sgr('30'),
  accentUser: sgr('30'),
  capsuleFg: sgr('30'),
  pasteFg: sgr('30'),
};

export type ThemeName = 'dark' | 'light' | 'plain';

export function plainPalette(): Palette {
  const empty = Object.fromEntries(Object.keys(GROKNIGHT).map((key) => [key, ''])) as Record<Slot, string>;
  return { reset: '', bold: '', dim: '', ...empty };
}

export function buildPalette(opts: { color: boolean; truecolor: boolean; theme?: ThemeName }): Palette {
  const theme = opts.theme ?? 'dark';
  if (!opts.color || theme === 'plain') return plainPalette();
  const table = theme === 'light' ? NOVADAY : GROKNIGHT;
  const ansi = theme === 'light' ? ANSI16_LIGHT : ANSI16;
  const slots = Object.fromEntries(
    (Object.keys(GROKNIGHT) as Slot[]).map((key) => [key, opts.truecolor ? fg(table[key]) : ansi[key]]),
  ) as Record<Slot, string>;
  return { reset: sgr('0'), bold: sgr('1'), dim: slots.gray, ...slots };
}

/** Wrap text in a colour, restoring the palette's default afterwards. */
export function paint(palette: Palette, color: string, text: string): string {
  return color === '' ? text : `${color}${text}${palette.reset}`;
}

/** Wrap text in a capsule (background + foreground), for selected segments. */
export function capsule(palette: Palette, text: string): string {
  if (palette.capsuleBg === '' && palette.capsuleFg === '') return text;
  return `${palette.capsuleBg}${palette.capsuleFg}${text}${palette.reset}`;
}

/**
 * Usage colour by breakpoint. ANSI-16 cannot blend a gradient, so this is a
 * snapshot rule (grok's own `t < 0.5` rounding): neutral → cyan → amber → red.
 */
export function usageUrgency(ratio: number, palette: Palette): string {
  if (ratio >= 0.9) return palette.fail;
  if (ratio >= 0.7) return palette.warn;
  if (ratio >= 0.5) return palette.accent;
  return palette.text;
}

/**
 * Wave brightness: `sin²(tick * speed + row / waveRows * 2π)` (grok's
 * `wave_brightness`, `tokyonight.rs:344`). Used to blend a rail row's colour
 * so the lit segment travels down a multi-row block instead of every row
 * flickering on its own phase.
 */
export function waveBrightness(tick: number, row: number, waveRows = 32, speed = 0.15): number {
  const phase = (row / Math.max(1, waveRows)) * 2 * Math.PI;
  return Math.sin(tick * speed + phase) ** 2;
}

/** Blend a colour toward the background by `brightness` (grok's `blend_color`). */
export function blend(base: string, color: string, brightness: number): string {
  const a = rgb(base);
  const b = rgb(color);
  if (a === undefined || b === undefined) return color;
  const t = Math.min(1, Math.max(0, brightness));
  return fg(hex(a.map((channel, i) => Math.round(channel + (b[i]! - channel) * t))));
}

function rgb(color: string): [number, number, number] | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (match === null) return undefined;
  const value = Number.parseInt(match[1]!, 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function hex(channels: readonly number[]): string {
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** The default theme's background — `Palette.bg` is the honest source. */
export const BG_BASE = GROKNIGHT.bg;