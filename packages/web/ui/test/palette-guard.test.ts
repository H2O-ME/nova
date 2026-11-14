/**
 * Palette-invariant guard. The token layer is exempt from the "no literal
 * colors" rule (it is where the values live), which means nothing else in the
 * suite would notice the surfaces and the ink drifting out of order. These
 * three invariants are the ones that broke silently last time and are invisible
 * to every other check:
 *
 *  1. **The surface ladder is monotonic in BOTH palettes.** A "sunken" sidebar
 *     that renders lighter than the page it sits under is not a subtler
 *     ladder — it is a contradiction between the name and the pixels, and it
 *     reads as a flat theme with a highlighted sidebar for no reason.
 *  2. **Secondary ink clears the WCAG AA floor for small text.** This UI sets
 *     12–13px descriptive copy in `secondary`/`muted` throughout the settings
 *     columns; 4.5:1 is the floor for正文 that size, and the ramp used to sit
 *     at 3.58:1 while looking perfectly fine in a screenshot.
 *  3. **Selected and hovered rows are not the same pixels.** Sharing one wash
 *     made "the session I am reading" indistinguishable from "the row under
 *     the pointer".
 *
 * Assertions are relational (ordering, ratios, distinctness), never literal
 * color values — a deliberate retune of the palette must not turn this red,
 * only an inversion or a regression across a threshold will.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** Pull the value of one custom property out of the FIRST block it appears in
 *  (the `:root` block for the light palette). */
function tokenIn(css: string, name: string, from: 'light' | 'dark'): string {
  const blocks = [...css.matchAll(/(?::root|body\[data-nova-dark\])\s*\{([^}]*)\}/g)];
  const wanted = from === 'light' ? 'root' : 'nova-dark';
  // The light palette is the `:root` block; dark lives in its own selector.
  for (const block of blocks) {
    const isDark = block[0].includes('data-nova-dark');
    if ((from === 'dark') !== isDark) continue;
    expect(block[0], `block lookup for ${name} in ${wanted} palette`).toBeTruthy();
    const hit = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(block[1] ?? '');
    if (hit?.[1]) return hit[1].trim();
  }
  throw new Error(`token ${name} not found in ${from} palette`);
}

function rgbOf(value: string): [number, number, number] {
  const m = /rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(value);
  if (!m) throw new Error(`not an rgb() color: ${value}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Perceptual luminance (WCAG 2.x). */
function luminance([r, g, b]: [number, number, number]): number {
  const f = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe('palette invariants', () => {
  it('the surface ladder runs sunken < base < raised in BOTH palettes', () => {
    const surface = read('design/tokens/surface.css');
    for (const palette of ['light', 'dark'] as const) {
      const sunken = luminance(rgbOf(tokenIn(surface, '--nova-surface-sunken', palette)));
      const base = luminance(rgbOf(tokenIn(surface, '--nova-surface-base', palette)));
      const raised = luminance(rgbOf(tokenIn(surface, '--nova-surface-raised', palette)));
      // Strictly ordered: the three planes must be distinguishable, not equal.
      // Light mode once held all three at #fff and dark ran sunken ABOVE base.
      expect(sunken, `${palette}: sunken must be darker than base`).toBeLessThan(base);
      expect(base, `${palette}: base must be darker than raised`).toBeLessThan(raised);
    }
  });

  it('secondary ink clears the small-text contrast floor on its own plane', () => {
    const surface = read('design/tokens/surface.css');
    const text = read('design/tokens/text.css');
    for (const palette of ['light', 'dark'] as const) {
      const base = rgbOf(tokenIn(surface, '--nova-surface-base', palette));
      // `secondary` and `muted` both carry body-size descriptive copy; both
      // must clear 4.5:1 against the plane they render on.
      for (const name of ['--nova-text-secondary', '--nova-text-muted']) {
        const ratio = contrast(rgbOf(tokenIn(text, name, palette)), base);
        expect(ratio, `${palette} ${name} = ${ratio.toFixed(2)}:1, needs ≥ 4.5`).toBeGreaterThanOrEqual(4.5);
      }
      // `faint` is the annotation rung (timestamps, unit suffixes) — held to
      // the large-text floor instead, because 4.5 here would collapse it into
      // `muted` and lose the step.
      const faintRatio = contrast(rgbOf(tokenIn(text, '--nova-text-faint', palette)), base);
      expect(faintRatio, `${palette} faint = ${faintRatio.toFixed(2)}:1, needs ≥ 3`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the selected session row is distinguishable from a hovered one', () => {
    // The row used to paint `--nova-interactive-hover` for BOTH states. The
    // contract: selection carries its own identity. The 2026-10 answer was the
    // accent; measured against the reference's sidebar the blue row + rail was
    // the loudest colour in the chrome, so selection is now the STRONGER rung
    // of the same neutral (hover 5.5% ink, selected 12%) — distinct by
    // strength, not by hue.
    const sheet = read('sidebar/SessionRow.module.css');
    const selected = /\.sessionRow\.selected\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? '';
    expect(selected, 'selected row must declare its own background').toContain('background:');
    expect(selected, 'selected row must not reuse the hover wash').not.toContain(
      'var(--nova-interactive-hover)'
    );
    expect(selected, 'selection is the strong neutral rung').toContain(
      'var(--nova-interactive-hover-strong)'
    );
    // The accent rail is gone with the accent surface: the sidebar carries no
    // accent of its own any more.
    expect(sheet, 'selection must not paint a leading rail').not.toContain(
      '.sessionRow.selected::before'
    );
  });
});

/**
 * Shape-language guards. These pin the direction the operator has actually
 * asked for, so a later pass cannot silently revert it:
 *
 *  - The composer is a QUIET SURFACE: a hairline, the shared 12px corner, no
 *    float and no accent bloom. The earlier "generous corner + stroke-free
 *    float" rule was reversed on 2026-11-05 — on the product's paper ground it
 *    read as 「卡通」 next to the reference's flat composer.
 *  - The reader's bubble is ONE quiet plane (`surface-sunken`), not a
 *    translucent wash with a hairline. The wash was the earlier experiment and
 *    looked like a tinted sticker on the neutral page.
 *  - Repeated rows inside a list take NO frame. Re-framing them is what turned
 *    the model settings page into a table of boxes.
 */
describe('shape language', () => {
  it('the composer takes the reference card recipe (2026-11-14 ZCode alignment)', () => {
    const text = read('composer/InputBar.module.css');
    const card = /^\.card \{([^}]*)\}/m.exec(text)?.[1] ?? '';
    expect(card, 'the composer takes the 16px corner').toContain('var(--nova-radius-lg)');
    expect(card, 'the composer carries the soft two-layer shadow').toContain(
      'var(--nova-elevation-composer)'
    );
    expect(card, 'the composer border rides the input-border token').toContain(
      'var(--nova-input-border)'
    );
    expect(text, 'the send control must not paint the accent ramp').not.toContain(
      'var(--nova-color-accent-gradient)'
    );
  });

  it('provider rows carry no frame; the group is divided by rules instead', () => {
    const sheet = read('settings/ProviderSection.module.css');
    const card = /^\.card \{([^}]*)\}/m.exec(sheet)?.[1] ?? '';
    expect(card, 'provider row must not draw a border').toContain('border: 0');
    expect(card, 'provider row must not carry its own fill').toContain('background: transparent');
    // Separation moved to the list rule; without it the rows would run together.
    expect(sheet, 'the row group needs a hairline divider').toContain('.rows > li:not(:last-child)');
    // The add affordance is a secondary action, not a dashed drop target.
    const add = /^\.addButton \{([^}]*)\}/m.exec(sheet)?.[1] ?? '';
    expect(add, 'add button must not be a dashed slab').not.toContain('dashed');
  });

  it('the transcript separates turns with space, not a full-width rule', () => {
    // A full-width hairline between every turn is the right device for a
    // settings list (parallel records) and the wrong one for a conversation:
    // at 8–16px of surrounding rhythm a 14%-opacity rule spanning the column is
    // the strongest mark on screen, and a screen of them reads as a ruled
    // spreadsheet. The turn row must not draw a bottom border.
    const header = read('chat/TurnHeader.module.css');
    const root = /^\.root \{([^}]*)\}/m.exec(header)?.[1] ?? '';
    expect(root, 'the turn row must not rule itself off').not.toMatch(/border-bottom:\s*[^;]*\bsolid\b/);
  });

  it('the user bubble is one quiet plane, not a tinted wash', () => {
    const bubble = /^\.bubble \{([^}]*)\}/m.exec(read('chat/MessageItem.module.css'))?.[1] ?? '';
    expect(bubble, 'bubble fill is the quiet sunken plane').toContain('var(--nova-surface-sunken)');
    expect(bubble, 'the bubble carries no outline').toMatch(/border:\s*0;/);
    expect(bubble, 'the bubble takes the large standalone corner').toContain('var(--nova-radius-xl)');
  });

  it('the composer keeps ONE text floor across the hero and docked seats', () => {
    // Hero and docked floors used to be 68 and 36. Sending the first message
    // re-seats the card, and that 32px difference made the input appear to jump
    // in one frame — the "尺寸忽大忽小" report. A second `min-height` on any
    // `.hero .input`-style override would silently reintroduce the jump, so the
    // sheet must declare exactly one floor and no hero override.
    const sheet = read('composer/InputBar.module.css');
    const floors = [...sheet.matchAll(/min-height:\s*([^;]+);/g)].map((m) => m[1]?.trim());
    expect(floors, 'the composer must declare exactly one text floor').toHaveLength(1);
    expect(sheet, 'no per-seat floor override may exist').not.toMatch(/\.hero\s+\.input\s*\{/);
  });

  it('the transcript rhythm matches the reference', () => {
    // The reference's own values: 16px default, 8px only for the answer that
    // follows a closed process. Any per-row private gap is the 「间距忽大忽小」
    // the operator reported.
    const sheet = read('chat/ChatView.module.css');
    const fallback = /margin-top:\s*var\(--nova-chat-flow-gap,\s*(\d+)px\)/.exec(sheet)?.[1];
    expect(fallback, 'the default flow gap is the 16px rhythm').toBe('16');
    expect(sheet, 'the closed-process answer is the 8px exception').toMatch(
      /data-chat-group-part='response'\][\s\S]{0,80}--nova-chat-flow-gap:\s*8px/
    );
  });

  it('a mounted transcript row animates in', () => {
    // The sheet carried sixty-odd animation references and every one belonged to
    // a disclosure, so nothing moved when a message actually arrived — which is
    // why a live turn read as static text appearing in place.
    //
    // Comments are stripped first: the rule's own doc-comment NAMES the keyframe
    // it uses, so a naive `toContain` would pass on a row whose declaration had
    // been deleted. Only a live `animation:` declaration counts.
    const raw = /^\.flowItem \{([^}]*)\}/m.exec(read('chat/ChatView.module.css'))?.[1] ?? '';
    const decl = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(decl, 'the row wrapper must declare the shared entrance').toMatch(
      /animation:\s*nova-fade-up/
    );
  });
});
