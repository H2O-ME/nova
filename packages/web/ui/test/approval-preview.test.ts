/**
 * The approval preview's row model. The lines under test are the exact strings
 * `plugins/builtin/fs.ts` emits for an approval ask — an `edit_file` diff under
 * its own header, a `write_file` summary with no diff lines at all, and a
 * truncated hunk whose marker is neither header nor change.
 */
import { describe, expect, it } from 'vitest';
import { hasPreview, previewRows, previewStats } from '../src/approval/preview-model.js';

describe('previewRows', () => {
  it('reads the first unprefixed line as the path header', () => {
    const rows = previewRows(['编辑 src/a.ts（1 处替换）：', '- const a = 1', '+ const a = 2']);
    expect(rows).toEqual([
      { kind: 'path', text: '编辑 src/a.ts（1 处替换）：' },
      { kind: 'del', text: 'const a = 1' },
      { kind: 'add', text: 'const a = 2' },
    ]);
  });

  it('strips the tool prefix so the stylesheet owns the sign (never doubled)', () => {
    const rows = previewRows(['head', '- - kept dash', '+ + kept plus']);
    expect(rows[1]).toEqual({ kind: 'del', text: '- kept dash' });
    expect(rows[2]).toEqual({ kind: 'add', text: '+ kept plus' });
  });

  it('keeps an empty removed line as an empty del row', () => {
    expect(previewRows(['head', '- ', '+ tail'])).toEqual([
      { kind: 'path', text: 'head' },
      { kind: 'del', text: '' },
      { kind: 'add', text: 'tail' },
    ]);
  });

  it('marks write_file metadata and truncation markers as dim', () => {
    expect(previewRows(['写入 src/a.ts（12 字符）', '首行: hello', '  …'])).toEqual([
      { kind: 'path', text: '写入 src/a.ts（12 字符）' },
      { kind: 'dim', text: '首行: hello' },
      { kind: 'dim', text: '  …' },
    ]);
  });

  it('an empty preview has no rows, and is not worth a block', () => {
    expect(previewRows([])).toEqual([]);
    expect(hasPreview(undefined)).toBe(false);
    expect(hasPreview([])).toBe(false);
    expect(hasPreview(['写入 a'])).toBe(true);
  });
});

describe('previewStats', () => {
  it('counts the change lines the footer prints', () => {
    const rows = previewRows(['head', '- a', '- b', '+ c', '  …']);
    expect(previewStats(rows)).toEqual({ added: 1, removed: 2 });
  });

  it('a summary without diff lines has nothing to total', () => {
    expect(previewStats(previewRows(['写入 a（3 字符）', '首行: abc']))).toEqual({ added: 0, removed: 0 });
  });
});