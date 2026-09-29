/**
 * Syntax highlighting without a highlighter dependency: a scanner per language
 * family producing per-line runs tagged with shiki's css-variables token
 * kinds. The harness runs shiki's JavaScript engine with a
 * `createCssVariablesTheme('--shiki-')` theme; this build ships no
 * dependencies, so the same token vocabulary is produced here and the colors
 * still come from the vendored `styles/shiki.css` sheet (`--shiki-token-*`).
 *
 * Two invariants make it safe to use in a renderer:
 *  - **Lossless.** Every character of the source appears exactly once across
 *    the runs, in order ({@link highlightLines}'s contract, asserted in tests),
 *    so the highlighted tree and the plain tree render identical text.
 *  - **Unknown means plain.** A language with no scanner returns undefined and
 *    the caller draws its unhighlighted `<pre>`, exactly as shiki does for a
 *    grammar it has no loader for.
 */

/** Shiki's css-variables theme token set, as the kinds this scanner emits. */
export type HlKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'keyword'
  | 'constant'
  | 'number'
  | 'function'
  | 'parameter'
  | 'punctuation'
  | 'string-expression';

/** One run of source text and the token kind it reads as. */
export interface HlSpan {
  text: string;
  kind: HlKind;
}

/** One source line as runs; `text` fields concatenate back to the line. */
export type HlLine = HlSpan[];

/**
 * Token kind → the custom property the theme sheet defines. Values are the
 * sheet's own variable names (styles/shiki.css owns their light/dark values).
 */
export const TOKEN_VAR: Record<Exclude<HlKind, 'plain'>, string> = {
  comment: 'var(--shiki-token-comment)',
  string: 'var(--shiki-token-string)',
  keyword: 'var(--shiki-token-keyword)',
  constant: 'var(--shiki-token-constant)',
  number: 'var(--shiki-token-constant)',
  function: 'var(--shiki-token-function)',
  parameter: 'var(--shiki-token-parameter)',
  punctuation: 'var(--shiki-token-punctuation)',
  'string-expression': 'var(--shiki-token-string-expression)',
};

/** One language family's lexical rules. */
interface LangSpec {
  /** Line-comment prefixes, longest first. */
  line: readonly string[];
  /** Block-comment delimiters. */
  block?: { open: string; close: string };
  /** Quote characters; a backtick-syntax language lets them span lines. */
  quotes: readonly string[];
  /** Quote characters whose literal may contain a newline. */
  multiline?: readonly string[];
  keywords: ReadonlySet<string>;
  constants: ReadonlySet<string>;
  /** Sigil introducing a variable reference (`$VAR`, `${VAR}`). */
  variable?: string;
  /** Sigil introducing a decorator/attribute name. */
  decorator?: string;
}

const C_KEYWORDS = words('abstract as async await break case catch class const continue declare default delete do else enum export extends finally for from function get if implements import in instanceof interface let new of private protected public readonly return set static super switch this throw try type typeof var void while yield');
const C_CONSTANTS = words('true false null undefined NaN Infinity');
const PY_KEYWORDS = words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield None True False self');
const SHELL_KEYWORDS = words('if then else elif fi for while until do done case esac function in select time return break continue local export readonly declare source alias unset echo cd set unset exit');
const GO_KEYWORDS = words('break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false');
const RUST_KEYWORDS = words('as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self static struct super trait true type unsafe use where while');
const YAML_CONSTANTS = words('true false null yes no on off');

function words(list: string): ReadonlySet<string> {
  return new Set(list.split(' '));
}

const C_LIKE: LangSpec = { line: ['//'], block: { open: '/*', close: '*/' }, quotes: ["'", '"', '`'], multiline: ['`'], keywords: C_KEYWORDS, constants: C_CONSTANTS };
const GO_LIKE: LangSpec = { line: ['//'], block: { open: '/*', close: '*/' }, quotes: ["'", '"', '`'], multiline: ['`'], keywords: GO_KEYWORDS, constants: words('true false nil iota') };
const RUST_LIKE: LangSpec = { line: ['//'], block: { open: '/*', close: '*/' }, quotes: ['"', "'"], keywords: RUST_KEYWORDS, constants: words('true false None Some Ok Err') };
const PYTHON: LangSpec = { line: ['#'], quotes: ['"', "'"], keywords: PY_KEYWORDS, constants: words('True False None'), decorator: '@' };
const SHELL: LangSpec = { line: ['#'], quotes: ['"', "'"], multiline: ['"', "'"], keywords: SHELL_KEYWORDS, constants: words('true false'), variable: '$' };
const JSON_LIKE: LangSpec = { line: [], quotes: ['"'], keywords: new Set(), constants: words('true false null') };
const CONFIG: LangSpec = { line: ['#'], quotes: ['"', "'"], keywords: new Set(), constants: YAML_CONSTANTS };

/** Fence info string → the scanner that reads it (absent = plain `<pre>`). */
const LANGUAGES: Record<string, LangSpec> = {
  ts: C_LIKE, tsx: C_LIKE, typescript: C_LIKE, js: C_LIKE, jsx: C_LIKE, javascript: C_LIKE, mjs: C_LIKE, cjs: C_LIKE,
  java: C_LIKE, c: C_LIKE, h: C_LIKE, cpp: C_LIKE, 'c++': C_LIKE, cc: C_LIKE, hpp: C_LIKE, cs: C_LIKE, csharp: C_LIKE,
  kotlin: C_LIKE, kt: C_LIKE, swift: C_LIKE, php: C_LIKE, scala: C_LIKE, dart: C_LIKE, css: C_LIKE, scss: C_LIKE, less: C_LIKE,
  go: GO_LIKE, golang: GO_LIKE,
  rs: RUST_LIKE, rust: RUST_LIKE,
  py: PYTHON, python: PYTHON,
  sh: SHELL, bash: SHELL, zsh: SHELL, shell: SHELL, shellscript: SHELL, console: SHELL,
  json: JSON_LIKE, jsonc: JSON_LIKE, json5: JSON_LIKE,
  yml: CONFIG, yaml: CONFIG, toml: CONFIG, ini: CONFIG, conf: CONFIG, properties: CONFIG, dotenv: CONFIG, env: CONFIG,
};

/**
 * The scanner for a fence info string, or undefined when no scanner reads it.
 * `Object.hasOwn` and not a bare index: the table is an object literal, so an
 * info string like `constructor` or `__proto__` would otherwise resolve to an
 * inherited member and reach `scan()` as a non-spec.
 * @param lang - the fence's grammar id (already truncated to `[\w-]+`).
 * @returns the scanner, or undefined.
 */
function specFor(lang: string | undefined): LangSpec | undefined {
  if (lang === undefined) return undefined;
  const key = lang.toLowerCase();
  return Object.hasOwn(LANGUAGES, key) ? LANGUAGES[key] : undefined;
}

/**
 * Highlight one fence into per-line runs, or return undefined for a language
 * without a scanner (the caller then renders the plain `<pre>`).
 * @param code - the fence body exactly as authored.
 * @param lang - the fence's grammar id (already truncated to `[\w-]+`).
 * @returns one run list per line, or undefined.
 */
export function highlightLines(code: string, lang: string | undefined): HlLine[] | undefined {
  const spec = specFor(lang);
  if (spec === undefined) return undefined;
  return toLines(scan(code, spec));
}

/**
 * Whether a fence's info string resolves to a scanner. The code toolbar reads
 * this to decide between the authored language id and its own generic label —
 * the same test the highlighter itself applies, so a label never names a
 * language whose body renders plain.
 * @param lang - the fence's grammar id.
 * @returns whether `highlightLines` would read it.
 */
export function supportsHighlighting(lang: string | undefined): boolean {
  return specFor(lang) !== undefined;
}

/** Split the flat run list into lines, keeping the lossless invariant. */
function toLines(spans: HlSpan[]): HlLine[] {
  const lines: HlLine[] = [[]];
  let line = lines[0] as HlLine;
  for (const span of spans) {
    const parts = span.text.split('\n');
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) {
        line = [];
        lines.push(line);
      }
      const part = parts[i] ?? '';
      if (part.length > 0) line.push({ text: part, kind: span.kind });
    }
  }
  return lines;
}

/** The scanner: one pass, every character consumed into exactly one run. */
function scan(code: string, spec: LangSpec): HlSpan[] {
  const out: HlSpan[] = [];
  const push = (text: string, kind: HlKind): void => {
    const last = out[out.length - 1];
    if (last !== undefined && last.kind === kind) last.text += text;
    else out.push({ text, kind });
  };
  let i = 0;
  while (i < code.length) {
    const ch = code[i] ?? '';
    const line = spec.line.find((prefix) => code.startsWith(prefix, i));
    if (line !== undefined) {
      const end = lineEnd(code, i);
      push(code.slice(i, end), 'comment');
      i = end;
      continue;
    }
    if (spec.block !== undefined && code.startsWith(spec.block.open, i)) {
      const close = code.indexOf(spec.block.close, i + spec.block.open.length);
      const end = close === -1 ? code.length : close + spec.block.close.length;
      push(code.slice(i, end), 'comment');
      i = end;
      continue;
    }
    if (spec.quotes.includes(ch)) {
      const quoted = readQuoted(code, i, spec);
      for (const span of quoted.spans) push(span.text, span.kind);
      i = quoted.end;
      continue;
    }
    if (spec.variable !== undefined && ch === spec.variable) {
      const end = variableEnd(code, i, spec.variable);
      push(code.slice(i, end), 'parameter');
      i = end;
      continue;
    }
    if (spec.decorator !== undefined && ch === spec.decorator && isIdentStart(code[i + 1])) {
      const end = identEnd(code, i + 1);
      push(code.slice(i, end), 'function');
      i = end;
      continue;
    }
    if (isDigit(ch) && !isIdentPart(code[i - 1])) {
      const end = numberEnd(code, i);
      push(code.slice(i, end), 'number');
      i = end;
      continue;
    }
    if (isIdentStart(ch)) {
      const end = identEnd(code, i);
      const word = code.slice(i, end);
      push(word, wordKind(code, end, word, spec));
      i = end;
      continue;
    }
    push(ch, /[\p{P}\p{S}]/u.test(ch) ? 'punctuation' : 'plain');
    i += 1;
  }
  return out;
}

function wordKind(code: string, end: number, word: string, spec: LangSpec): HlKind {
  if (spec.keywords.has(word)) return 'keyword';
  if (spec.constants.has(word)) return 'constant';
  return nextSignificant(code, end) === '(' ? 'function' : 'plain';
}

function nextSignificant(code: string, from: number): string {
  let i = from;
  while (i < code.length && (code[i] === ' ' || code[i] === '\t')) i += 1;
  return code[i] ?? '';
}

function lineEnd(code: string, from: number): number {
  const nl = code.indexOf('\n', from);
  return nl === -1 ? code.length : nl;
}

/**
 * One quoted literal: a plain string, or — where the language interpolates —
 * a string whose `$VAR` runs are pulled out as parameter spans (the shell case
 * a transcript is full of: `echo "$HOME"`).
 */
function readQuoted(code: string, start: number, spec: LangSpec): { spans: HlSpan[]; end: number } {
  const quote = code[start] ?? '"';
  const spansLines = spec.multiline?.includes(quote) === true;
  const interpolates = spec.variable !== undefined && quote === '"';
  const spans: HlSpan[] = [];
  let text = quote;
  let i = start + 1;
  while (i < code.length) {
    const ch = code[i] ?? '';
    if (ch === '\\') {
      text += code.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (interpolates && ch === spec.variable) {
      const end = variableEnd(code, i, spec.variable);
      if (end > i + 1) {
        if (text.length > 0) spans.push({ text, kind: 'string' });
        spans.push({ text: code.slice(i, end), kind: 'parameter' });
        text = '';
        i = end;
        continue;
      }
    }
    if (ch === quote) {
      text += ch;
      i += 1;
      break;
    }
    if (ch === '\n' && !spansLines) break;
    text += ch;
    i += 1;
  }
  if (text.length > 0) spans.push({ text, kind: 'string' });
  return { spans, end: i };
}

/** `$NAME` / `${NAME}` / `$1` — the parameter run a variable sigil opens. */
function variableEnd(code: string, start: number, sigil: string): number {
  if (code[start + 1] === '{') {
    const close = code.indexOf('}', start + 2);
    return close === -1 ? code.length : close + 1;
  }
  if (!isIdentStart(code[start + 1]) && !isDigit(code[start + 1])) return start + sigil.length;
  return identEnd(code, start + 1);
}

function numberEnd(code: string, start: number): number {
  let i = start;
  while (i < code.length && /[0-9a-fA-FxXoObBeE._+-]/.test(code[i] ?? '')) {
    // Only a signed exponent keeps the sign inside the number.
    const ch = code[i] ?? '';
    if ((ch === '+' || ch === '-') && !/[eE]/.test(code[i - 1] ?? '')) break;
    i += 1;
  }
  return i;
}

function identEnd(code: string, start: number): number {
  let i = start;
  while (i < code.length && isIdentPart(code[i])) i += 1;
  return i;
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}_$@]/u.test(ch);
}

function isIdentPart(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}_$]/u.test(ch);
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}