/**
 * The open file, beside the tree: its document bar, its mode, and its text.
 *
 * The editor is a `<textarea>` rather than a code-editor component (this bundle
 * ships React and nothing else), and the honest alternative to a rich editor is
 * a plain one that writes exactly what it shows. A markdown document gets a
 * 预览 mode using the same element-tree renderer the transcript uses; nothing
 * else does.
 *
 * Three readings come from the host and stay three: **binary**, **oversized**
 * (`truncated`) and **unreadable** (`error`) each say their own sentence — an
 * empty textarea would claim the file is empty.
 */
import { useEffect, useRef, useState } from 'react';
import { MarkdownText } from '../chat/markdown/MarkdownText.js';
import { CloseIcon, FileIcon } from '../icons.js';
import type { ClientFrame } from '../types.js';
import type { Action } from '../state.js';
import { RIGHTBAR_COPY } from './copy.js';
import type { EditorDoc, EditorState } from './editor-model.js';
import { EditGlyph, PreviewGlyph } from './panel-icons.js';
import { Chip, IconButton, Notice } from './kit.js';
import css from './PreviewPane.module.css';

export interface PreviewPaneProps {
  editor: EditorState;
  /** The reducer's dispatch (the editor slice is owned by the reducer). */
  dispatch: (action: Action) => void;
  send: (frame: ClientFrame) => void;
}

/** Whether a path is markdown (the preview toggle's only gate). */
export function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/iu.test(path);
}

/** Last path segment (the chip's label). */
export function baseName(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return at === -1 ? path : path.slice(at + 1);
}

export function PreviewPane({ editor, dispatch, send }: PreviewPaneProps): JSX.Element | null {
  const doc = editor.docs.find((candidate) => candidate.path === editor.active) ?? null;
  // No document: the file page shows the tree alone (FilesView owns that choice),
  // so this pane renders nothing rather than a placeholder pretending to be a page.
  if (doc === null) return null;
  return (
    <div className={css.pane}>
      <div className={css.bar}>
        <div className={css.docs} role="tablist" aria-label={RIGHTBAR_COPY['editor.open']}>
          {editor.docs.map((open) => (
            <span key={open.path} className={css.docChip} data-active={open.path === editor.active ? '' : undefined}>
              <button
                type="button"
                role="tab"
                aria-selected={open.path === editor.active}
                className={css.docPick}
                title={open.path}
                onClick={() => { dispatch({ type: 'editor_activate', path: open.path }); }}
              >
                <FileIcon className={css.docGlyph} />
                <span className={css.docName}>{baseName(open.path)}</span>
                {open.dirty && <span className={css.dirtyDot} aria-label={RIGHTBAR_COPY['editor.dirty']} />}
              </button>
              <button
                type="button"
                className={css.docClose}
                aria-label={RIGHTBAR_COPY['editor.close']}
                title={RIGHTBAR_COPY['editor.close']}
                onClick={() => { dispatch({ type: 'editor_close', path: open.path }); }}
              >
                <CloseIcon />
              </button>
            </span>
          ))}
        </div>
      </div>
      <DocBody key={doc.path} doc={doc} dispatch={dispatch} send={send} />
    </div>
  );
}

interface DocBodyProps {
  doc: EditorDoc;
  dispatch: (action: Action) => void;
  send: (frame: ClientFrame) => void;
}

/**
 * One document's reading surface.
 *
 * Held as its own component keyed by path, so the 预览 toggle is per
 * document-lifetime: one file's preview mode is not another's.
 */
function DocBody({ doc, dispatch, send }: DocBodyProps): JSX.Element {
  const [preview, setPreview] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);

  // Ctrl/Cmd+S saves while the editor has the keyboard. Bound on the textarea
  // (not the document) so it never fights the shell's own keys.
  useEffect(() => {
    const area = areaRef.current;
    if (area === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        send({ type: 'write_entry', path: doc.path, content: doc.text });
      }
    };
    area.addEventListener('keydown', onKey);
    return () => { area.removeEventListener('keydown', onKey); };
  }, [doc, send]);

  const readonly = doc.loading || doc.error !== undefined || doc.binary || doc.truncated || preview;
  const markdown = isMarkdown(doc.path);
  return (
    <div className={css.body}>
      <div className={css.modeBar}>
        <span className={css.pathLine} title={doc.path}>
          <span className={css.pathName}>{baseName(doc.path)}</span>
        </span>
        {markdown && !doc.loading && doc.error === undefined && !doc.binary && !doc.truncated && (
          <Chip selected={preview} onClick={() => { setPreview(!preview); }}>
            {preview ? <PreviewGlyph /> : <EditGlyph />}
            {preview ? RIGHTBAR_COPY['editor.preview'] : RIGHTBAR_COPY['editor.edit']}
          </Chip>
        )}
        <IconButton label={RIGHTBAR_COPY['editor.close']} size="sm" onClick={() => { dispatch({ type: 'editor_close', path: doc.path }); }}>
          <CloseIcon />
        </IconButton>
      </div>
      {doc.loading && <Notice kind="loading">{RIGHTBAR_COPY['editor.loading']}</Notice>}
      {doc.error !== undefined && (
        <Notice kind="error">{RIGHTBAR_COPY['editor.readError'].replace('{message}', doc.error)}</Notice>
      )}
      {doc.binary && <Notice kind="warn">{RIGHTBAR_COPY['editor.binary']}</Notice>}
      {doc.truncated && (
        <Notice kind="warn">
          {RIGHTBAR_COPY['editor.truncated'].replace('{kb}', String(Math.ceil(doc.bytes / 1024)))}
        </Notice>
      )}
      {doc.saveError !== undefined && (
        <Notice kind="error">{RIGHTBAR_COPY['editor.saveFailed'].replace('{message}', doc.saveError)}</Notice>
      )}
      {!doc.loading && doc.error === undefined && !doc.binary && !doc.truncated && (
        preview
          ? (
            <div className={css.previewBody} data-readable="">
              <MarkdownText text={doc.text} />
            </div>
          )
          : (
            <textarea
              ref={areaRef}
              className={css.area}
              data-readonly={readonly ? '' : undefined}
              value={doc.text}
              spellCheck={false}
              aria-label={doc.path}
              onChange={(event) => { dispatch({ type: 'editor_edit', path: doc.path, text: event.target.value }); }}
            />
          )
      )}
    </div>
  );
}
