/**
 * Token ownership guard. Two rules, both machine-checked here because neither
 * survives review:
 *
 *  1. **Components consume tokens, never literal colors.** `.ts`/`.tsx` and
 *     every component module (`src/**\/*.module.css`) must reach color only
 *     through `var(--dsw-*)` / `var(--dsh-*)`. The token layer under
 *     `src/styles/` is the one place raw values live (it is the ported harness
 *     palette, licensed and attributed); `src/index.css` is a mount sheet and
 *     is held to the component rule.
 *  2. **A styled class is a rendered class.** Each `X.module.css` must have
 *     every class it defines written literally in a source file of the same
 *     directory. A dead rule costs nothing to keep and everything to explain
 *     later — `ChatView`'s legacy dock seat and the header's compact button
 *     both outlived their elements by a batch before this check caught them.
 *
 * ANSI escapes are forbidden everywhere in the bundle: styling a browser
 * surface with terminal escapes renders as literal junk, and it means a TUI
 * helper leaked into this one.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** The token layer: the one subtree that may hold raw color values. */
const TOKEN_DIR = 'styles';

/** Literal color matchers: hex (#abc / #aabbcc) and bare rgb()/rgba() calls. */
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_RE = /\brgb(a)?\s*\(/g;

interface Entry {
  /** Path relative to `src`, with `/` separators. */
  rel: string;
  text: string;
}

/** Every file under `src` matching `exts`, token layer excluded. */
function listSources(exts: RegExp, includeTokenLayer = false): Entry[] {
  const out: Entry[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (rel === '' && entry.name === TOKEN_DIR && !includeTokenLayer) continue;
        walk(abs, relPath);
      } else if (exts.test(entry.name)) {
        out.push({ rel: relPath, text: readFileSync(abs, 'utf8') });
      }
    }
  };
  walk(SRC, '');
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function literalColors(text: string): string[] {
  return [...new Set([...(text.match(HEX_RE) ?? []), ...(text.match(RGB_RE) ?? [])])];
}

describe('token ownership', () => {
  it('no literal colors in component sources (.ts/.tsx)', () => {
    const offenders = listSources(/\.(ts|tsx)$/)
      .map((file) => ({ file, hits: literalColors(file.text) }))
      .filter(({ hits }) => hits.length > 0)
      .map(({ file, hits }) => `${file.rel}: ${hits.join(' ')}`);
    expect(offenders).toEqual([]);
  });

  it('no literal colors in component CSS (modules and the mount sheet)', () => {
    const offenders = listSources(/\.css$/)
      .map((file) => ({ file, hits: literalColors(file.text) }))
      .filter(({ hits }) => hits.length > 0)
      .map(({ file, hits }) => `${file.rel}: ${hits.join(' ')}`);
    expect(offenders).toEqual([]);
  });

  it('no ANSI escapes anywhere in the frontend source', () => {
    const esc = String.fromCharCode(27) + '[';
    const offenders = [...listSources(/\.(ts|tsx|css)$/, true), ...htmlEntries()]
      .filter((file) => file.text.includes(esc))
      .map((file) => file.rel);
    expect(offenders).toEqual([]);
  });

  /**
   * Every class a module styles must appear in a source file of that module's
   * own subtree — the component beside it, or a nested piece of the same
   * surface (`chat/markdown/` renders `chat/`'s table hook). Scoped per subtree
   * on purpose: a name that only appears three folders away is a coincidence,
   * not a consumer.
   */
  it('every class a CSS module styles is written literally by its own surface', () => {
    const modules = listSources(/\.module\.css$/, true);
    const sources = listSources(/\.(ts|tsx)$/).filter(
      (file) => !file.rel.endsWith('.test.ts') && !file.rel.endsWith('.test.tsx'),
    );
    const dead: string[] = [];
    for (const sheet of modules) {
      const dir = sheet.rel.includes('/') ? sheet.rel.slice(0, sheet.rel.lastIndexOf('/')) : '';
      const owned = sources.filter((file) => dir === '' || file.rel.startsWith(`${dir}/`));
      const text = owned.map((file) => file.text).join('\n');
      for (const name of classesOf(sheet.text)) {
        if (!text.includes(name)) dead.push(`${sheet.rel}: .${name}`);
      }
    }
    expect(dead.sort()).toEqual([]);
  });

  /**
   * Every inline `<svg>` declares its design box (`width={16}` / `width="14"`).
   * An SVG carrying only a `viewBox` has **no intrinsic size**: in a flex row it
   * contributes nothing to its parent's intrinsic width, so the parent sizes
   * short and wraps its own label around it — the inspect pill rendered as a
   * 44px blob with its two-character label stacked vertically, and the mode
   * triggers' chevrons collapsed to 0×0. CSS still scales an icon down where a
   * call site wants it smaller (`.triggerIcon svg` 14px, `.inspectButton svg`
   * 12px); the attribute is the floor, not the size.
   */
  it('every inline svg declares its design box', () => {
    const offenders: string[] = [];
    for (const file of listSources(/\.tsx$/)) {
      for (const tag of svgTags(file.text)) {
        if (!/\bwidth[=:]/.test(tag)) offenders.push(`${file.rel}: ${tag.replace(/\s+/g, ' ').slice(0, 72)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/** Each `<svg …>` opening tag in a source file, up to its closing bracket. */
function svgTags(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/<svg[\s>]/g)) {
    const start = match.index ?? 0;
    const end = text.indexOf('>', start);
    if (end > start) out.push(text.slice(start, end));
  }
  return out;
}

/** The mount document, held to the same no-escapes rule as the bundle. */
function htmlEntries(): Entry[] {
  return [{ rel: 'index.html', text: readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8') }];
}

/** Class names a sheet defines (comments stripped: ported names are prose). */
function classesOf(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...new Set([...stripped.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1] ?? ''))];
}