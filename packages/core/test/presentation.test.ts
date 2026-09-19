/**
 * The presentation vocabulary must stay *shape only*. These tests are the fence
 * that keeps it that way: semantics equivalence with the behavior the terminal
 * view layer used to own (so adopting the vocabulary cannot change a pixel),
 * and a textual guard against copy / color / width leaking into `core`.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TOOL_KINDS,
  isFailureContent,
  isPathArgKind,
  isReadOnlyKind,
  toolCallKind,
} from '../src/index.js';

describe('isFailureContent', () => {
  // Cases pinned to the pre-move terminal implementation, byte for byte: the
  // function changed packages, not semantics.
  const cases: [string, boolean][] = [
    ['Error: file not found: x.ts', true],
    ['Permission denied: by user: nope', true],
    ['exit: 1\nstdout:\n(empty)', true],
    ['exit: 0\nstdout:\nok', false],
    ['exit: null\n[command did not exit: killed after timeout or aborted]', true],
    ['wrote 12 chars to a.ts', false],
    ['a.ts:1: const x = 1', false],
    ['\nstdout:\nexit: 2', true],
    ['a.ts:7: call process.exit: 2 loudly', false],
  ];
  for (const [content, expected] of cases) {
    it(`classifies ${JSON.stringify(content.slice(0, 28))} as ${expected ? 'failure' : 'success'}`, () => {
      expect(isFailureContent(content)).toBe(expected);
    });
  }
});

describe('tool call kinds', () => {
  it('every built-in kind is a member of the vocabulary', () => {
    const known = new Set(['read', 'edit', 'write', 'search', 'execute', 'job', 'plan', 'other']);
    for (const kind of Object.values(BUILTIN_TOOL_KINDS)) {
      expect(known.has(kind)).toBe(true);
    }
  });

  it('unknown tools classify as other instead of throwing', () => {
    expect(toolCallKind('some_third_party_tool')).toBe('other');
    expect(isReadOnlyKind(toolCallKind('nope'))).toBe(false);
    expect(isPathArgKind(toolCallKind('nope'))).toBe(false);
  });

  /**
   * These two sets are exactly what the terminal view layer used to hardcode by
   * tool name (`READ_ONLY_TOOLS`, `PATH_ARG_TOOLS`). Deriving them from kinds
   * must agree on every name, or adopting the vocabulary would have changed
   * live-row grouping and path clipping.
   */
  const READ_ONLY_BY_NAME = ['read_file', 'list_dir', 'search_files'];
  const PATH_ARG_BY_NAME = ['read_file', 'write_file', 'edit_file', 'list_dir'];
  const ALL_NAMES = [...new Set([...Object.keys(BUILTIN_TOOL_KINDS), ...READ_ONLY_BY_NAME, ...PATH_ARG_BY_NAME])];

  it('read-only grouping matches the historical name list', () => {
    for (const name of ALL_NAMES) {
      expect(isReadOnlyKind(toolCallKind(name))).toBe(READ_ONLY_BY_NAME.includes(name));
    }
  });

  it('path-argument grouping matches the historical name list', () => {
    for (const name of ALL_NAMES) {
      expect(isPathArgKind(toolCallKind(name))).toBe(PATH_ARG_BY_NAME.includes(name));
    }
  });
});

describe('vocabulary stays presentation-free', () => {
  const source = () => readFile(fileURLToPath(new URL('../src/presentation.ts', import.meta.url)), 'utf8');

  it('carries no ANSI escapes, palette or column-width concepts', async () => {
    const text = await source();
    expect(text).not.toContain(String.fromCodePoint(0x1b));
    expect(text).not.toMatch(/\bPalette\b/);
    expect(text).not.toMatch(/\bcols\b/);
    expect(text).not.toMatch(/maxCols|styledWidth|clipToWidth/);
  });

  it('carries no user-facing copy (labels are each surface localization)', async () => {
    const text = await source();
    // No CJK anywhere in the file, comments included: a Chinese label has to
    // start somewhere, and this is not that place.
    expect(text).not.toMatch(/[一-鿿]/);
  });
});
