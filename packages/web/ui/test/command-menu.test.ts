/**
 * The `/` menu's rules, asserted without a DOM: when it opens, what it lists,
 * what a pick writes, and what a submitted draft means. The last one is the
 * contract that matters most — a draft is either a command frame or a prompt,
 * and a surface must never swallow text the kernel's registry does not claim.
 */
import { describe, expect, it } from 'vitest';
import { commandDraft, commandItems, draftFrame, menuSettlesOnEnter, slashQuery } from '../src/composer/command-menu.js';

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

  it('is null for anything that is not a leading slash', () => {
    expect(slashQuery('hello')).toBeNull();
    expect(slashQuery('')).toBeNull();
    expect(slashQuery('see /compact')).toBeNull();
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
    expect(commandDraft('compact')).toBe('/compact ');
    expect(slashQuery(commandDraft('compact'))).toBeNull();
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