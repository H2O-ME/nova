/**
 * The `/` menu's rules, asserted without a DOM: when it opens, what it lists,
 * what a pick writes, and what a submitted draft means. The last one is the
 * contract that matters most — a draft is either a command frame or a prompt,
 * and a surface must never swallow text the kernel's registry does not claim.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComposerMenu } from '../src/composer/ComposerMenu.js';
import { commandDraft, commandItems, commandSpan, draftFrame, menuKeyDecision, menuSettlesOnEnter, slashQuery } from '../src/composer/command-menu.js';

const COMMANDS = [
  { name: 'compact', description: '压缩上下文：总结历史' },
  { name: 'skill', description: '加载一个技能' },
];

describe('menuSettlesOnEnter', () => {
  it('settles an empty draft and a slash query, but not prose', () => {
    // The `+` control pins the menu open over whatever is typed. If Enter
    // settled it then, the pick would overwrite the draft and the prompt would
    // never be sent — Enter is "send" for prose.
    expect(menuSettlesOnEnter('')).toBe(true);
    expect(menuSettlesOnEnter('   ')).toBe(true);
    expect(menuSettlesOnEnter('/com')).toBe(true);
    expect(menuSettlesOnEnter('写一个函数')).toBe(false);
  });

  it('reads the caret, not the draft tail, when the token is mid-sentence', () => {
    // The regression this pins: the caller passed only the draft, so this test
    // defaulted the caret to the END while the menu's open state was derived
    // WITH the caret. With the menu visibly open on a live mid-draft `/` token,
    // Enter then failed to settle, fell through to the send path, and the
    // highlighted command was silently replaced by its own prose.
    const mid = 'hello /com world';
    expect(slashQuery(mid, 10)).toBe('com');
    expect(menuSettlesOnEnter(mid, 10)).toBe(true);
    // The same draft read from its end has no live token — which is exactly the
    // disagreement that made the omission invisible.
    expect(slashQuery(mid)).toBeNull();
    expect(menuSettlesOnEnter(mid)).toBe(false);
  });
});

describe('menuKeyDecision', () => {
  // These replace a component-level seam that no test could reach (the UI lane
  // has no DOM). The three bugs they pin all used to live in the component's
  // inline branch: a missing caret, a drill chevron nothing handled, and Tab
  // being folded into the settle path.
  const DIR = { drill: true };
  const FILE = { drill: false };

  it('passes every key through when there is no row to act on', () => {
    for (const key of ['Enter', 'Tab', 'ArrowDown', 'ArrowUp', 'a']) {
      expect(menuKeyDecision(key, '@src', 4, undefined)).toEqual({ kind: 'pass' });
    }
  });

  it('moves on the arrows and passes everything else', () => {
    expect(menuKeyDecision('ArrowDown', '@src', 4, FILE)).toEqual({ kind: 'move', delta: 1 });
    expect(menuKeyDecision('ArrowUp', '@src', 4, FILE)).toEqual({ kind: 'move', delta: -1 });
    expect(menuKeyDecision('a', '@src', 4, FILE)).toEqual({ kind: 'pass' });
    expect(menuKeyDecision('Escape', '@src', 4, FILE)).toEqual({ kind: 'pass' });
  });

  it('drills a directory on Tab, and only a directory', () => {
    // The regression: `onDrill` was never passed by the only call site, so the
    // chevron rendered, was focusable, carried `进入目录` and did nothing.
    // `@sr` is a live reference, which is the state these rows exist in.
    expect(menuKeyDecision('Tab', '@sr', 3, DIR, true)).toEqual({ kind: 'pick', drill: true });
    expect(menuKeyDecision('Tab', '@sr', 3, FILE, true)).toEqual({ kind: 'pick', drill: false });
    // Enter never drills: it takes the row, which for a directory is the same
    // descent, but the two keys stay distinguishable at the seam.
    expect(menuKeyDecision('Enter', '@sr', 3, DIR, true)).toEqual({ kind: 'pick', drill: false });
  });

  it('settles a live token at the CARET, and refuses over prose', () => {
    // The regression: the caret was omitted here while the menu's open state was
    // derived with it, so a mid-draft token settled nothing and Enter submitted
    // the prose instead of running the highlighted command.
    expect(menuKeyDecision('Enter', 'hello /com world', 10, FILE)).toEqual({ kind: 'pick', drill: false });
    // The same draft read from its tail is prose, and Enter must be the send.
    expect(menuKeyDecision('Enter', 'hello /com world', 16, FILE)).toEqual({ kind: 'pass' });
    // An empty draft settles (nothing is lost), plain prose never does.
    expect(menuKeyDecision('Enter', '', 0, FILE)).toEqual({ kind: 'pick', drill: false });
    expect(menuKeyDecision('Enter', '写一个函数', 5, FILE)).toEqual({ kind: 'pass' });
  });

  it('settles a live @ reference too, which the slash-only test never did', () => {
    // The regression this pins: the menu opens for a live `/` token OR a live
    // `@` reference, but the settle test only ever knew about `/`. So with the
    // FILE menu visibly open on `@src/ma`, Enter submitted the raw mention text
    // as prose and the highlighted file was never taken.
    expect(menuKeyDecision('Enter', '@src/ma', 7, FILE, true)).toEqual({ kind: 'pick', drill: false });
    expect(menuKeyDecision('Enter', '@src/ma', 7, FILE, false)).toEqual({ kind: 'pass' });
    // Both triggers at once (a command whose argument mentions a file) settles.
    expect(menuKeyDecision('Enter', '/skill @src', 11, FILE, true)).toEqual({ kind: 'pick', drill: false });
    // A reference row that is a DIRECTORY drills on Tab, same as a slash row.
    expect(menuKeyDecision('Tab', '@sr', 3, DIR, true)).toEqual({ kind: 'pick', drill: true });
  });
});

describe('slashQuery', () => {
  it('reads the command word being typed', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/com')).toBe('com');
    expect(slashQuery('  /compact')).toBe('compact');
  });

  it('stops claiming the draft once a space ends the command word', () => {
    // Past the argument separator the user is writing prose (or args) — a menu
    // that stayed open would cover the draft it is filtering.
    expect(slashQuery('/compact now please')).toBeNull();
    expect(slashQuery('/skill ')).toBeNull();
  });

  it('opens after whitespace or punctuation, not inside a word', () => {
    // The reference scans backward from the CARET for a `/` at a word boundary
    // (`ui-input-trigger/core/detect.ts`): mid-sentence counts, `a/b` does not.
    expect(slashQuery('see /compact')).toBe('compact');
    expect(slashQuery('line one\n/compact')).toBe('compact');
    expect(slashQuery('see (/go')).toBe('go');
    expect(slashQuery('a/b')).toBeNull();
    expect(slashQuery('hello')).toBeNull();
    expect(slashQuery('')).toBeNull();
  });

  it('keeps `/` dead inside URLs', () => {
    // Both carve-outs from the reference: the second slash of `//`, and a slash
    // right after a scheme-separating colon.
    expect(slashQuery('see https://example')).toBeNull();
    expect(slashQuery('https://a.b/c/d')).toBeNull();
    expect(slashQuery('C:/path')).toBeNull();
    // A colon that is ordinary punctuation does not suppress the trigger.
    expect(slashQuery('note: /go')).toBe('go');
  });

  it('reads the token ending at the caret, not the draft tail', () => {
    // The scan is caret-relative: a caret past the token is not editing it.
    expect(slashQuery('/compact now', 8)).toBe('compact');
    expect(slashQuery('/compact now', 12)).toBeNull();
    expect(slashQuery('/compact', 4)).toBe('com');
  });
});

describe('commandItems', () => {
  it('lists the whole catalog for an empty query, in registry order', () => {
    expect(commandItems(COMMANDS, '').map((item) => item.id)).toEqual(['compact', 'skill']);
  });

  it('shows the token to type as the label and the description beside it', () => {
    expect(commandItems(COMMANDS, 'com')[0]).toMatchObject({ id: 'compact', label: '/compact' });
    expect(commandItems(COMMANDS, 'com')[0]?.description).toContain('压缩');
  });

  it('matches the name first and falls back to the description', () => {
    expect(commandItems(COMMANDS, 'sk').map((item) => item.id)).toEqual(['skill']);
    expect(commandItems(COMMANDS, '上下文').map((item) => item.id)).toEqual(['compact']);
    expect(commandItems(COMMANDS, 'zzz')).toEqual([]);
  });

  it('is case-insensitive on both axes', () => {
    expect(commandItems(COMMANDS, 'SKILL').map((item) => item.id)).toEqual(['skill']);
  });
});

describe('commandDraft', () => {
  it('writes the token plus the space its argument goes in', () => {
    // The trailing space is what closes the menu: the next Enter is the send.
    expect(commandDraft('/com', 'compact')).toBe('/compact ');
    expect(slashQuery(commandDraft('/com', 'compact'))).toBeNull();
  });

  it('rewrites only the live token, so a command typed mid-draft keeps its surroundings', () => {
    expect(commandDraft('run /com now', 'compact', 8)).toBe('run /compact  now');
    // With no live token the pick stands alone rather than guessing a span.
    expect(commandDraft('plain prose', 'compact')).toBe('/compact ');
  });
});

describe('commandSpan', () => {
  it('names the span a pick replaces', () => {
    expect(commandSpan('/com')).toEqual({ start: 0, end: 4, query: 'com' });
    expect(commandSpan('run /com now', 8)).toEqual({ start: 4, end: 8, query: 'com' });
  });
});

describe('draftFrame', () => {
  it('routes a known command to a command frame', () => {
    expect(draftFrame('/compact', COMMANDS)).toEqual({ type: 'command', name: 'compact', args: '' });
    expect(draftFrame('  /compact  ', COMMANDS)).toEqual({ type: 'command', name: 'compact', args: '' });
  });

  it('hands the rest of the line to the command as its argument', () => {
    // `/skill pdf-tools` is one command with one argument, not a prompt that
    // mentions a slash.
    expect(draftFrame('/skill pdf-tools', COMMANDS)).toEqual({ type: 'command', name: 'skill', args: 'pdf-tools' });
  });

  it('matches the name case-insensitively but sends the registered spelling', () => {
    expect(draftFrame('/Compact', COMMANDS)).toEqual({ type: 'command', name: 'compact', args: '' });
  });

  it('leaves everything else a prompt', () => {
    // The registry never claimed this name, so the surface must not eat it.
    expect(draftFrame('/teleport', COMMANDS)).toEqual({ type: 'prompt', text: '/teleport' });
    expect(draftFrame('see /compact docs', COMMANDS)).toEqual({ type: 'prompt', text: 'see /compact docs' });
    expect(draftFrame('/compactx', COMMANDS)).toMatchObject({ type: 'prompt' });
    expect(draftFrame('plain words', COMMANDS)).toMatchObject({ type: 'prompt' });
    // With no catalog at all (a kernel that registered nothing) every slash is prose.
    expect(draftFrame('/compact', [])).toMatchObject({ type: 'prompt' });
  });
});

describe('the trigger menu exposes its highlight to assistive technology', () => {
  // The regression this pins: focus never leaves the textarea (the combobox
  // pattern), so the armed row was expressed ONLY as a CSS class — the listbox
  // had no `aria-activedescendant` and its rows had no ids. A screen reader heard
  // the list but never which row the arrows had parked on.
  const ITEMS = [
    { id: 'a', label: '第一' },
    { id: 'b', label: '第二', active: true },
    { id: 'c', label: '第三' },
  ];

  it('points aria-activedescendant at the armed row, by that row own id', () => {
    const html = renderToStaticMarkup(createElement(ComposerMenu, {
      items: ITEMS,
      ariaLabel: '命令',
      listboxId: 'menu-x',
    }));
    expect(html).toContain('id="menu-x"');
    // The listbox names the row it is armed on…
    expect(html).toContain('aria-activedescendant="menu-x-row-1"');
    // …and that id is really on the second row, not merely a string that matches.
    expect(html).toContain('id="menu-x-row-1"');
    // Every row is addressable, so the pointer can never dangle.
    expect(html).toContain('id="menu-x-row-0"');
    expect(html).toContain('id="menu-x-row-2"');
  });

  it('omits the pointer entirely when nothing is armed', () => {
    // Naming an element that is not in the DOM is worse than naming nothing.
    const html = renderToStaticMarkup(createElement(ComposerMenu, {
      items: [{ id: 'a', label: '第一' }],
      ariaLabel: '命令',
      listboxId: 'menu-y',
    }));
    expect(html).not.toContain('aria-activedescendant');
  });

  it('degrades to no ids at all when the caller supplies no listbox id', () => {
    // The ids and the pointer are one feature: half of it would be a dangling
    // reference, so a caller that passes no id gets neither.
    const html = renderToStaticMarkup(createElement(ComposerMenu, {
      items: ITEMS,
      ariaLabel: '命令',
    }));
    expect(html).not.toContain('aria-activedescendant');
    expect(html).not.toContain('id="menu-');
  });
});