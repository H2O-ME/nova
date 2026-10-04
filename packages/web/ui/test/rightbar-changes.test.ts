/**
 * The 变更 tab's model (`rightbar/changes-model.ts`).
 *
 * What these assertions protect, in the order the tab's readers care:
 *
 *  - **The tab reads the VIEW vocabulary, not tool names.** A call whose view is
 *    a diff is a change; a call whose view is anything else is not — which is
 *    what lets a third-party editor show up here without this file knowing its
 *    name, and keeps a reader tool out of the list.
 *  - **The verdict belongs to the diff on screen.** The model folds a later call
 *    over the earlier one, and the earlier call's verdict must not survive: a
 *    settled 已完成 printed over a diff that is still being written is a lie the
 *    reader would act on.
 */
import { describe, expect, it } from 'vitest';
import { changesModel, emptyChanges, fileSummary } from '../src/rightbar/changes-model.js';
import type { Block } from '../src/state.js';
import type { FileDiff, ToolCallView } from '../src/types.js';

let seq = 0;

/** One tool block as the reducer holds it (view already resolved by the host). */
function toolBlock(
  view: ToolCallView,
  opts: { ok?: boolean; running?: boolean } = {},
): Extract<Block, { kind: 'tool' }> {
  seq += 1;
  return {
    id: `b${seq}`,
    kind: 'tool',
    callId: `c${seq}`,
    name: 'edit_file',
    args: '{}',
    view,
    ...(opts.running === true || opts.ok === undefined
      ? {}
      : { result: { card: 'diff' as const, ok: opts.ok, diffs: [] } }),
  };
}

const diffView = (diffs: FileDiff[]): ToolCallView => ({ card: 'diff', kind: 'edit', diffs });

describe('changes model', () => {
  it('reads diffs from the view vocabulary and ignores every other card', () => {
    const model = changesModel([
      toolBlock({ card: 'generic', kind: 'read', title: 'README.md' }),
      toolBlock({ card: 'terminal', kind: 'execute', command: 'ls' }),
      toolBlock(diffView([{ path: 'src/a.ts', oldText: 'one\n', newText: 'one\ntwo\n' }]), { ok: true }),
    ]);
    expect(model.files.map((file) => file.path)).toEqual(['src/a.ts']);
    expect(model).toMatchObject({ added: 1, removed: 0, calls: 1 });
  });

  it('keeps one entry per file, holding its newest diff', () => {
    const model = changesModel([
      toolBlock(diffView([{ path: 'src/a.ts', oldText: 'one\n', newText: 'two\n' }]), { ok: true }),
      toolBlock(diffView([{ path: 'src/b.ts', oldText: null, newText: 'new\n' }]), { ok: true }),
      toolBlock(diffView([{ path: 'src/a.ts', oldText: 'one\ntwo\n', newText: 'one\ntwo\nthree\n' }]), { ok: true }),
    ]);
    // Newest-touched first, and the counts are the LAST diff's numbers rather
    // than a sum over the whole session (a.ts was edited twice and shows one
    // add, not two).
    expect(model.files.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(model.files[0]).toMatchObject({ added: 1, removed: 0, calls: 2, created: false });
    expect(model.files[1]).toMatchObject({ created: true, calls: 1 });
    // The header's totals are the rows' totals, by construction.
    expect(model.added).toBe(model.files.reduce((sum, file) => sum + file.added, 0));
    expect(model.removed).toBe(model.files.reduce((sum, file) => sum + file.removed, 0));
  });

  it('never carries an earlier call’s verdict onto a diff that is still running', () => {
    const model = changesModel([
      toolBlock(diffView([{ path: 'src/a.ts', oldText: 'one\n', newText: 'two\n' }]), { ok: true }),
      // No result yet: this call is in flight.
      toolBlock(diffView([{ path: 'src/a.ts', oldText: 'one\n', newText: 'three\n' }]), { running: true }),
    ]);
    expect(model.files[0]?.ok).toBeUndefined();
  });

  it('says nothing when the session changed no files', () => {
    expect(changesModel([toolBlock({ card: 'terminal', kind: 'execute', command: 'ls' })])).toEqual(emptyChanges);
  });

  it('labels a created file apart from an edit', () => {
    const created = changesModel([
      toolBlock(diffView([{ path: 'NEW.md', oldText: null, newText: 'a\nb\n' }]), { ok: true }),
    ]).files[0];
    expect(created).toBeDefined();
    const file = created as NonNullable<typeof created>;
    expect(fileSummary(file).startsWith('新文件 +')).toBe(true);
    // The count is the number of added rows the panel actually draws: a summary
    // that disagreed with the body below it would be the first thing a reader
    // notices, and the last thing they trust.
    expect(fileSummary(file)).toBe(`新文件 +${file.rows.filter((row) => row.t === 'add').length}`);
  });
});
