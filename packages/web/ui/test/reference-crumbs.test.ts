/**
 * The `@` menu's breadcrumb trail (`reference-crumbs.ts`).
 *
 * The contract under test: only a DRILL owes a trail — a typed path keeps its
 * context in the draft — and each crumb is the exact directory a drill pick
 * rewrites the token to, current step last and disabled.
 */
import { describe, expect, it } from 'vitest';
import { referenceCrumbs } from '../src/composer/reference-crumbs.js';

describe('referenceCrumbs', () => {
  it('an undrilled listing has no header, even for a directory path', () => {
    expect(referenceCrumbs('src/sub/', false)).toBeNull();
  });

  it('a drilled directory names the trail root first, current step last', () => {
    const crumbs = referenceCrumbs('src/sub/', true);
    expect(crumbs).toEqual([
      { label: '根目录', path: '', current: false },
      { label: 'src', path: 'src', current: false },
      { label: 'sub', path: 'src/sub', current: true },
    ]);
  });

  it('a drilled bare directory (no slash) has no trail to climb', () => {
    expect(referenceCrumbs('src', true)).toBeNull();
  });
});
