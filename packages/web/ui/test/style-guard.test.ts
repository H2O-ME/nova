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
   * Every class a module styles must be read through THAT module's own binding.
   *
   * The earlier form asked only whether the class name appeared anywhere in the
   * surface's source text, which a neighbouring sheet's `tailCss.actions`
   * satisfies for `AssistantMessage.module.css`'s `.actions` — so the dead
   * footer rule (inherited verbatim from the reference, where nothing consumes
   * it either) outlived the element it was written for, and the guard that was
   * supposed to catch exactly that stayed green. Names are now matched as
   * `<binding>.<class>`, where the binding must come from importing the very
   * sheet that defines the class; a binding used with an index access
   * (`css[kind]`) consumes that sheet wholesale.
   */
  it('every class a CSS module styles is read through that module\'s own binding', () => {
    const sources = listSources(/\.(ts|tsx)$/).filter(
      (file) => !file.rel.endsWith('.test.ts') && !file.rel.endsWith('.test.tsx'),
    );
    const dead = deadClasses(listSources(/\.module\.css$/, true), sources);
    expect(dead.sort()).toEqual([]);
  });

  it('catches a class whose name only appears as another sheet\'s property', () => {
    // The blind spot this guard was widened for, as a fixture: `actions` is
    // defined by A and read by B, and the old substring check accepted both.
    const sheets: Entry[] = [
      { rel: 'chat/A.module.css', text: '.actions {\n  margin-top: 16px;\n}\n' },
      { rel: 'chat/B.module.css', text: '.actions {\n  margin-top: 4px;\n}\n' },
    ];
    const consumers: Entry[] = [
      { rel: 'chat/B.tsx', text: "import tailCss from './B.module.css';\nexport const x = tailCss.actions;\n" },
    ];
    expect(deadClasses(sheets, consumers)).toEqual(['chat/A.module.css: .actions']);
  });

  it('accepts a dynamic binding and rejects a class read from an unrelated sheet', () => {
    const sheets: Entry[] = [
      { rel: 'composer/C.module.css', text: '.icon {\n  color: red;\n}\n.ts {\n  color: red;\n}\n' },
      { rel: 'composer/D.module.css', text: '.icon {\n  color: red;\n}\n' },
    ];
    const consumers: Entry[] = [
      { rel: 'composer/C.tsx', text: "import css from './C.module.css';\nexport const x = css.icon + css[kind];\n" },
      { rel: 'composer/D.tsx', text: "import css from './C.module.css';\nexport const y = css.icon;\n" },
    ];
    // `C.ts`'s own name is a table key, so the index access covers it; `D` is
    // read only through C's binding, which leaves `D.icon` unread.
    expect(deadClasses(sheets, consumers)).toEqual(['composer/D.module.css: .icon']);
  });

  /**
   * The other direction: every `css.<name>` a component writes must exist in a
   * sheet that module imports.
   *
   * The check above only walks CSS → consumer, so a component referring to a
   * class that no longer exists passes silently: `cx()` drops `undefined`, and a
   * bare `className={css.gone}` renders as no class at all. That is how
   * `ImageCard` kept `css.pending` after the class was renamed to `.spinner` —
   * the rendering was right and nothing reported the dead reference. A name is
   * accepted if ANY sheet in the module's own subtree defines it, since a
   * component may legitimately reach across sibling sheets of its surface.
   */
  it('every css.<name> a component references is defined by a sheet in its subtree', () => {
    const modules = listSources(/\.module\.css$/, true);
    const sources = listSources(/\.(ts|tsx)$/).filter(
      (file) => !file.rel.endsWith('.test.ts') && !file.rel.endsWith('.test.tsx'),
    );
    /** Every class name defined anywhere in the module's own subtree. */
    const definedBySubtree = (rel: string): Set<string> => {
      const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
      const names = new Set<string>();
      for (const sheet of modules) {
        if (dir !== '' && !sheet.rel.startsWith(`${dir}/`)) continue;
        for (const name of classesOf(sheet.text)) names.add(name);
      }
      return names;
    };
    const dead: string[] = [];
    for (const file of sources) {
      // `css.foo` / `styles.foo` — the two conventions the sheets are bound with.
      const refs = file.text.matchAll(/\b(?:css|styles)\.([A-Za-z_$][\w$]*)/g);
      const names = definedBySubtree(file.rel);
      for (const match of refs) {
        const name = match[1] as string;
        if (!names.has(name)) dead.push(`${file.rel}: css.${name}`);
      }
    }
    expect([...new Set(dead)].sort()).toEqual([]);
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

  /**
   * Every `--dsw-*` a component consumes must be DECLARED somewhere.
   *
   * `var(--dsw-alias-text-1)` looks exactly like a real token and resolves to
   * nothing: the declaration is dropped and the property falls back to whatever
   * it would have been anyway, so the rule silently styles nothing. It survived
   * review in the ported plan panel and was copied into the question card from
   * there — a typo that propagates by being plausible.
   *
   * Only the `--dsw-*` layer is checked, and only against CSS declarations: the
   * `--dsh-*` component-local family is published at RUNTIME for several of them
   * (`--dsh-chat-user-width` from the width observer, `--dsh-text-shimmer-spread`
   * from the shimmer), so requiring a static declaration would fail correct code.
   * The `--dsw-*` palette is static by contrast — a name that is not in the
   * stylesheet is not a palette entry at all.
   */
  it('every --dsw-* token a component consumes is declared in the token layer', () => {
    // Declared anywhere in the tree, and also by inline `style` maps that set a
    // token as a typed key (kept in the net so a future dynamic token passes).
    const declared = new Set<string>();
    for (const file of [...listSources(/\.css$/, true), ...listSources(/\.(ts|tsx)$/, true)]) {
      for (const match of file.text.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)) declared.add(match[1] ?? '');
    }
    const offenders: string[] = [];
    for (const file of listSources(/\.(css|ts|tsx)$/)) {
      for (const match of file.text.matchAll(/var\(\s*(--dsw-[a-z0-9-]+)/g)) {
        const name = match[1] ?? '';
        if (!declared.has(name)) offenders.push(`${file.rel}: ${name}`);
      }
    }
    expect([...new Set(offenders)].sort()).toEqual([]);
  });

  /**
   * A docked column draws no elevation.
   *
   * The right column (the panel pages) is a column of the page, not a float:
   * the harness gives the level-3 shadow to floating panes only (dockkit's
   * `.float`), and a docked column that carries it reads as a card hovering
   * over the conversation — the "floating" the operator reported even after
   * the column reserved its track. The sheet said "a column of the page, not
   * a raised surface" while declaring `box-shadow`; the prose and the
   * declaration were opposites, so the declaration is what this pins.
   */
  it('the docked right column declares no elevation', () => {
    const docked = ['rightbar/RightbarPanel.module.css'];
    const offenders: string[] = [];
    for (const rel of docked) {
      const text = stripComments(readFileSync(join(SRC, rel), 'utf8'));
      // The `.panel` block specifically: the fullscreen/takeover variants and
      // the sheet's other rules may legitimately differ.
      const block = /\.panel\s*\{([^}]*)\}/.exec(text)?.[1] ?? '';
      // Guard against a vacuous match: the block must be the panel shell.
      expect(block, `${rel}: .panel block not found`).toContain('position: absolute');
      if (block.includes('box-shadow')) offenders.push(`${rel}: .panel declares box-shadow`);
    }
    // The strip's sheet belongs to the same docked column but has no `.panel`
    // rule to anchor that check, so it is scanned whole.
    const strip = stripComments(readFileSync(join(SRC, 'rightbar/RightbarStrip.module.css'), 'utf8'));
    if (strip.includes('box-shadow')) offenders.push('rightbar/RightbarStrip.module.css: declares box-shadow');
    expect(offenders).toEqual([]);
  });

  /**
   * The terminal emulator loads xterm's OWN stylesheet.
   *
   * The helper layer's rules live there and nowhere else — above all
   * `.xterm-char-measure-element { visibility: hidden }`, which hides the
   * width-cache probe. That probe's text is the last measured glyph repeated
   * 32 times; with the sheet missing it paints as a visible line of junk
   * above the first row (the reported 乱码: a line of `>` before cmd's
   * banner), and the helper textarea renders as a box. A component sheet
   * cannot stand in: the class belongs to xterm's own injected markup.
   */
  it('the terminal emulator imports xterm\'s own stylesheet', () => {
    const hook = readFileSync(join(SRC, 'rightbar/use-terminal.ts'), 'utf8');
    expect(hook).toContain("'@xterm/xterm/css/xterm.css'");
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

/**
 * Class names a sheet defines. Comments are stripped (ported names are prose)
 * and `:global(...)` spans are dropped: those name the outside world — the
 * markdown renderer's own `md-table-wide` hook, the conversation host's scroll
 * attribute — and are read as literal strings by code that never imports this
 * sheet, so binding-matched consumption cannot see them.
 */
function classesOf(css: string): string[] {
  const stripped = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/:global\([^)]*\)/g, ' ');
  return [...new Set([...stripped.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((match) => match[1] ?? ''))];
}

/** The sheet a relative import specifier names, as a path relative to `src`. */
function resolveSheet(importerRel: string, specifier: string): string | null {
  if (!specifier.endsWith('.module.css')) return null;
  const dir = importerRel.includes('/') ? importerRel.slice(0, importerRel.lastIndexOf('/')) : '';
  const parts = dir === '' ? [] : dir.split('/');
  for (const segment of specifier.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

/**
 * Each sheet a source file imports, with the local names it binds that sheet to.
 * @param text - the source file's text.
 * @param importerRel - that file's path relative to `src`.
 * @returns sheet path → binding names (default and namespace imports).
 */
function cssBindings(text: string, importerRel: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const match of text.matchAll(/import\s+([^'"]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    const clause = match[1] ?? '';
    const sheet = resolveSheet(importerRel, match[2] ?? '');
    if (sheet === null) continue;
    const names: string[] = [];
    const defaultName = /^\s*([A-Za-z_$][\w$]*)/.exec(clause)?.[1];
    if (defaultName !== undefined) names.push(defaultName);
    const namespace = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(clause)?.[1];
    if (namespace !== undefined) names.push(namespace);
    out.set(sheet, [...(out.get(sheet) ?? []), ...names]);
  }
  return out;
}

/**
 * Find stylesheets whose classes no component reads.
 *
 * A class counts as read when a source file that imports its sheet writes
 * `<name>.<class>`, where `<name>` is either that sheet's binding or something
 * the file did not bind to a DIFFERENT sheet — a helper that takes the sheet as
 * a parameter (`renderFlowRows(rows, styles: typeof css)`) reads real classes
 * through it, while `tailCss.actions` in a file that binds `tailCss` to another
 * sheet is the coincidence this check exists to reject. A binding used with an
 * index access (`css[kind]`) or quoted in a string literal (`'shiki
 * css-variables'`, markdown hooks) reads every class that sheet defines.
 * @param sheets - the `*.module.css` entries.
 * @param sources - the `.ts`/`.tsx` entries that may consume them.
 * @returns one `"<sheet>: .<class>"` line per unread class, in sheet order.
 */
function deadClasses(sheets: readonly Entry[], sources: readonly Entry[]): string[] {
  const read = new Map<string, { classes: Set<string>; whole: boolean }>();
  const entryFor = (sheet: string): { classes: Set<string>; whole: boolean } => {
    let found = read.get(sheet);
    if (found === undefined) {
      found = { classes: new Set(), whole: false };
      read.set(sheet, found);
    }
    return found;
  };
  const known = new Map(sheets.map((sheet) => [sheet.rel, classesOf(sheet.text)]));
  for (const file of sources) {
    const bindings = cssBindings(file.text, file.rel);
    // Prose is not a consumer: a comment that mentions `.body` or a backticked
    // class name must not read the class it names.
    const code = stripComments(file.text);
    /** Every identifier this file references as `<ident>.<class>`. */
    const refs = [...code.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)]
      .map((match) => ({ ident: match[1] ?? '', name: match[2] ?? '' }));
    /** Every word that appears inside a quoted run (JSX attributes included). */
    const quoted = new Set<string>();
    for (const match of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)) {
      for (const word of (match[2] ?? '').matchAll(/[\w-]+/g)) quoted.add(word[0]);
    }
    for (const [sheet, names] of bindings) {
      const defined = known.get(sheet);
      if (defined === undefined) continue;
      const usage = entryFor(sheet);
      for (const binding of names) {
        if (new RegExp(`\\b${binding}\\s*\\[`).test(code)) usage.whole = true;
      }
      for (const name of defined) {
        if (quoted.has(name)) usage.classes.add(name);
        const hit = refs.some((ref) => ref.name === name && !foreignBinding(bindings, sheet, ref.ident));
        if (hit) usage.classes.add(name);
      }
    }
  }
  const dead: string[] = [];
  for (const sheet of sheets) {
    const usage = read.get(sheet.rel);
    if (usage?.whole === true) continue;
    for (const name of classesOf(sheet.text)) {
      if (usage?.classes.has(name) !== true) dead.push(`${sheet.rel}: .${name}`);
    }
  }
  return dead;
}

/**
 * Does this file bind `ident` to some sheet other than `sheet`? A positive
 * answer makes `<ident>.<class>` a reference to another module's class, which
 * is exactly the property that must not satisfy this sheet's own class.
 */
function foreignBinding(bindings: Map<string, string[]>, sheet: string, ident: string): boolean {
  for (const [other, names] of bindings) {
    if (other !== sheet && names.includes(ident)) return true;
  }
  return false;
}

/**
 * Drop comments so prose cannot read a class. The `//` form skips a preceding
 * colon, which keeps a `https://…` inside a string literal intact.
 * @param text - a source file's text.
 * @returns the same text with comments blanked.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

