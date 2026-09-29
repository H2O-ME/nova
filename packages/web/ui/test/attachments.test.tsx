/**
 * The attachment rail's contracts: what a file card says (extension, size,
 * state), how the rail decides its arrows and its wheel step, and which members
 * of a drop are directories.
 *
 * These are the three pieces of the dsh `ui-attachment` port that a reader
 * notices immediately — the card's second line, an arrow that must not appear
 * at the rail's end, and a dropped folder that must be refused rather than
 * uploaded as an empty file — and all three are pure, so none of them needs a
 * DOM.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { classifyFileType, fileExtension, fileMetaText, fileSizeText } from '../src/composer/file-type.js';
import { railEdges, railPageDistance, railWheelStep, PAGE_MIN_PX, WHEEL_LINE_PX, WHEEL_TICK_MAX_PX } from '../src/composer/attachment-rail.js';
import { droppedDirectories } from '../src/composer/drop-entries.js';
import { attachmentMentions, type UploadedFile } from '../src/composer/attachments.js';
import { FileCard } from '../src/composer/FileCard.js';

const LABELS = {
  label: '待发送文件',
  remove: '移除文件 a.txt',
  uploading: '上传中…',
  failed: '上传失败，点击重试',
  retry: '重试上传 a.txt',
};

describe('fileExtension', () => {
  it('takes the suffix after the last dot, on either separator', () => {
    expect(fileExtension('a/b/main.ts')).toBe('ts');
    expect(fileExtension('C:\\src\\main.tsx')).toBe('tsx');
    expect(fileExtension('README')).toBe('');
    // A trailing dot is not an extension.
    expect(fileExtension('name.')).toBe('');
  });
});

describe('classifyFileType', () => {
  it('maps the categories the surface gives a distinct glyph', () => {
    expect(classifyFileType('main.ts')).toBe('code');
    expect(classifyFileType('book.xlsx')).toBe('excel');
    expect(classifyFileType('index.html')).toBe('html');
    expect(classifyFileType('shot.PNG')).toBe('image');
    expect(classifyFileType('notes.md')).toBe('markdown');
    expect(classifyFileType('paper.pdf')).toBe('pdf');
    expect(classifyFileType('deck.pptx')).toBe('ppt');
    expect(classifyFileType('clip.mp4')).toBe('video');
    expect(classifyFileType('letter.docx')).toBe('word');
  });

  it('prefers a known filename to its extension', () => {
    // `README` has no extension at all; the name table is what makes it a
    // markdown document rather than the generic glyph.
    expect(classifyFileType('README')).toBe('markdown');
    expect(classifyFileType('docs/CHANGELOG')).toBe('markdown');
    expect(classifyFileType('Dockerfile')).toBe('code');
  });

  it('falls to the generic category rather than a wrong glyph', () => {
    expect(classifyFileType('archive.zip')).toBe('other');
    expect(classifyFileType('no-extension')).toBe('other');
  });

  it('treats a filename named after an Object.prototype member as unknown', () => {
    // Both tables are object literals, so a bare index would resolve these to
    // inherited members and hand a *function* to the icon where a FileType
    // string is required — the file card rendered a native-code string.
    for (const path of ['constructor', 'x.constructor', 'toString', '__proto__', 'x.valueOf']) {
      expect(classifyFileType(path)).toBe('other');
    }
  });
});

describe('fileSizeText', () => {
  it('reports whole units below the next rung and one decimal under ten', () => {
    expect(fileSizeText(0)).toBe('0B');
    expect(fileSizeText(512)).toBe('512B');
    expect(fileSizeText(1024)).toBe('1.0KB');
    expect(fileSizeText(4.2 * 1024)).toBe('4.2KB');
    expect(fileSizeText(20 * 1024)).toBe('20KB');
    expect(fileSizeText(1536 * 1024)).toBe('1.5MB');
  });
});

describe('fileMetaText', () => {
  it('reads extension then size, dropping an empty extension', () => {
    expect(fileMetaText('main.ts', 2048)).toBe('TS 2.0KB');
    expect(fileMetaText('LICENSE', 1024)).toBe('1.0KB');
  });

  it('caps a pathological extension so the size stays on the card', () => {
    expect(fileMetaText('a.verylongsuffixindeed', 10)).toBe('VERYLONG 10B');
  });
});

describe('FileCard', () => {
  it('names the file, its extension and its size at rest', () => {
    const html = renderToStaticMarkup(
      <FileCard name="main.ts" bytes={2048} state="ready" labels={LABELS} onRemove={() => {}} onRetry={() => {}} />,
    );
    expect(html).toContain('main.ts');
    expect(html).toContain('TS 2.0KB');
    // The remove control is present at rest (it reveals on hover in CSS, not in
    // the DOM) and the retry route is not.
    expect(html).toContain('aria-label="移除文件 a.txt"');
    expect(html).not.toContain('aria-label="重试上传 a.txt"');
  });

  it('swaps the meta line for the upload word and draws the progress rail', () => {
    const html = renderToStaticMarkup(
      <FileCard name="big.bin" bytes={4096} state="uploading" labels={LABELS} onRemove={() => {}} onRetry={() => {}} />,
    );
    expect(html).toContain('上传中…');
    expect(html).not.toContain('4.0KB');
    // The indeterminate sweep is the default: no inline width.
    expect(html).not.toContain('width:');
  });

  it('makes a reported fraction real rather than a sweep', () => {
    const html = renderToStaticMarkup(
      <FileCard name="big.bin" bytes={4096} state="uploading" progress={0.5} labels={LABELS} onRemove={() => {}} onRetry={() => {}} />,
    );
    expect(html).toContain('width:50%');
  });

  it('makes the failed body a retry control', () => {
    const html = renderToStaticMarkup(
      <FileCard name="a.txt" bytes={10} state="error" labels={LABELS} onRemove={() => {}} onRetry={() => {}} />,
    );
    expect(html).toContain('aria-label="重试上传 a.txt"');
    expect(html).toContain('上传失败，点击重试');
  });
});

describe('railEdges', () => {
  it('hides the left arrow at the start and the right one at the end', () => {
    expect(railEdges(0, 1200, 400)).toEqual({ left: false, right: true });
    expect(railEdges(400, 1200, 400)).toEqual({ left: true, right: true });
    expect(railEdges(800, 1200, 400)).toEqual({ left: true, right: false });
  });

  it('tolerates the fractional positions engines report at the edges', () => {
    // Without the 1px slack a rounded position leaves an arrow on at the end.
    expect(railEdges(800.4, 1200, 400).right).toBe(false);
    expect(railEdges(0.5, 1200, 400).left).toBe(false);
  });

  it('shows neither arrow when nothing overflows', () => {
    expect(railEdges(0, 400, 400)).toEqual({ left: false, right: false });
  });
});

describe('railPageDistance', () => {
  it('keeps one card of context, with a floor for a narrow rail', () => {
    expect(railPageDistance(600)).toBe(536);
    // A rail narrower than a card still pages a useful distance.
    expect(railPageDistance(120)).toBe(PAGE_MIN_PX);
  });
});

describe('railWheelStep', () => {
  it('leaves a pure horizontal pan to the browser', () => {
    expect(railWheelStep({ deltaX: 12, deltaY: 0, deltaMode: 0 }, 400)).toBeNull();
  });

  it('converts a vertical wheel into a horizontal step', () => {
    expect(railWheelStep({ deltaX: 0, deltaY: 10, deltaMode: 0 }, 400)).toBe(10);
    expect(railWheelStep({ deltaX: 0, deltaY: -10, deltaMode: 0 }, 400)).toBe(-10);
  });

  it('normalizes Firefox line and page deltas before clamping', () => {
    expect(railWheelStep({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 400)).toBe(3 * WHEEL_LINE_PX);
    // A page-unit delta scales by the viewport, so one notch already exceeds
    // the per-tick clamp — the same clamp the reference applies to every unit.
    expect(railWheelStep({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 400)).toBe(WHEEL_TICK_MAX_PX);
    // A fast wheel must stay followable, not jump a whole viewport.
    expect(railWheelStep({ deltaX: 0, deltaY: 500, deltaMode: 0 }, 400)).toBe(WHEEL_TICK_MAX_PX);
  });

  it('keeps a diagonal trackpad pan diagonal but scaled', () => {
    expect(railWheelStep({ deltaX: 5, deltaY: 2, deltaMode: 1 }, 400)).toBe(5 * WHEEL_LINE_PX);
  });
});

describe('droppedDirectories', () => {
  const file = (name: string): File => new File(['x'], name);

  it('names the members the entry API reports as directories', () => {
    const a = file('a.txt');
    const dir = file('folder');
    const b = file('b.txt');
    const items = [
      { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) },
      { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) },
      { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) },
    ];
    const found = droppedDirectories(items, [a, dir, b]);
    expect(found.has(dir)).toBe(true);
    expect(found.has(a)).toBe(false);
    expect(found.has(b)).toBe(false);
  });

  it('reports no directories when the engine has no entry API', () => {
    // The `File` a folder drop yields is indistinguishable from an empty file,
    // so guessing would upload an empty card — reporting none is the safe read.
    const a = file('a');
    expect(droppedDirectories([{ kind: 'file' }], [a]).size).toBe(0);
    expect(droppedDirectories([{ kind: 'file', webkitGetAsEntry: () => null }], [a]).size).toBe(0);
  });

  it('keeps the file index aligned across non-file items', () => {
    const a = file('a');
    const dir = file('folder');
    const items = [
      { kind: 'string' },
      { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) },
      { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) },
    ];
    const found = droppedDirectories(items, [a, dir]);
    expect(found.has(a)).toBe(true);
    expect(found.has(dir)).toBe(false);
  });
});

describe('a referenced local file reaches the model as a mention', () => {
  // The shape this pins changed with the feature: an attachment is now a
  // POINTER to a path the host named, never a copy. `path` is therefore
  // required and every row is `ready` — there is no transfer to be in flight
  // and none to fail. What still matters is that the mention is the whole
  // wiring: naming the path in the prompt is what makes `read_file` reach it.
  const row = (over: Partial<UploadedFile> = {}): UploadedFile => ({
    id: 'a',
    name: 'report.pdf',
    path: '/tmp/report.pdf',
    bytes: 0,
    status: 'ready',
    ...over,
  });

  it('names every referenced file by its REAL absolute path', () => {
    const text = attachmentMentions([
      row({ id: 'a', path: '/home/u/docs/report.pdf' }),
      row({ id: 'b', path: '/home/u/docs/notes.txt' }),
    ]);
    expect(text).toBe('@/home/u/docs/report.pdf\n@/home/u/docs/notes.txt');
  });

  it('never names a path inside the old upload cache', () => {
    // The regression the redesign removed: bytes were copied into
    // `~/.nova/cache/uploads/` and the mention pointed THERE, so a 4 GB video
    // was duplicated on disk for a model that reads text. A reference must name
    // where the file already lives.
    const text = attachmentMentions([row({ path: '/home/u/movies/clip.mp4' })]);
    expect(text).toBe('@/home/u/movies/clip.mp4');
    expect(text).not.toContain('.nova');
  });

  it('quotes a path that carries whitespace, so it stays one token', () => {
    expect(attachmentMentions([row({ path: '/tmp/a b/c.txt' })])).toBe('@"/tmp/a b/c.txt"');
  });

  it('skips a path the mention grammar cannot represent instead of mangling it', () => {
    // A control character cannot be escaped in `@path` grammar; writing it
    // anyway would name a DIFFERENT file. Skipping is the honest answer.
    expect(attachmentMentions([row({ path: '/tmp/a\u0000b.txt' })])).toBe('');
    // The well-formed sibling still rides along.
    const text = attachmentMentions([row({ id: 'bad', path: '/tmp/a"b.txt' }), row({ id: 'ok', path: '/tmp/ok.txt' })]);
    expect(text).toBe('@/tmp/ok.txt');
  });

  it('is empty when there is nothing staged, so a plain prompt is unchanged', () => {
    expect(attachmentMentions([])).toBe('');
  });
});
