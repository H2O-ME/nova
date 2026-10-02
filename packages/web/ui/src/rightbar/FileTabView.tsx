/**
 * One file tab: a READ-ONLY viewer (the reference's document preview —
 * ui-sidebar-documentpreview — is a viewer, and this port keeps that shape).
 *
 * Code files get line numbers and syntax highlighting (the chat markdown
 * scanner's one scan per language family — no Shiki), markdown renders through
 * the same element-tree renderer the transcript uses, everything else is the
 * plain text. The verbs are a viewer's verbs: wrap, copy, re-read. The editor
 * (a textarea + Ctrl+S + a dirty dot pretending to be an editor) is gone on
 * purpose — the wire budget (`MAX_EDITOR_BYTES`) is a read budget, not a
 * write buffer, and a viewer that cannot write cannot lose work either.
 *
 * Three readings come from the host and stay three: **binary**, **oversized**
 * (`truncated`) and **unreadable** (`error`) each say their own sentence — an
 * empty pane would claim the file is empty.
 */
import { useMemo, useState } from 'react';
import { MarkdownText } from '../chat/markdown/MarkdownText.js';
import { TOKEN_VAR } from '../chat/markdown/highlight.js';
import { highlightLines } from '../chat/markdown/highlight.js';
import type { ClientFrame } from '../types.js';
import { RIGHTBAR_COPY } from './copy.js';
import type { EditorDoc } from './editor-model.js';
import { langOfPath } from './diff-highlight.js';
import { RefreshGlyph } from './panel-icons.js';
import { Chip, IconButton, Notice } from './kit.js';
import css from './FileTabView.module.css';

export interface FileTabViewProps {
  doc: EditorDoc;
  send: (frame: ClientFrame) => void;
}

/** Whether a path is markdown (rendered, not shown as source). */
export function isMarkdown(path: string): boolean {
  return /\.(md|markdown|mdx)$/iu.test(path);
}

export function FileTabView({ doc, send }: FileTabViewProps): JSX.Element {
  const [wrap, setWrap] = useState(false);
  const [copied, setCopied] = useState(false);
  const markdown = isMarkdown(doc.path);
  const readable = !doc.loading && doc.error === undefined && !doc.binary && !doc.truncated;
  const lines = useMemo(
    () => (readable && !markdown ? doc.text.split('\n') : []),
    [readable, markdown, doc.text],
  );
  const highlighted = useMemo(
    () => (readable && !markdown ? highlightLines(doc.text, langOfPath(doc.path)) : undefined),
    [readable, markdown, doc.text, doc.path],
  );

  const copy = (): void => {
    navigator.clipboard?.writeText(doc.text).then(() => {
      setCopied(true);
      window.setTimeout(() => { setCopied(false); }, 1500);
    }, () => { /* clipboard refusal is a dead verb, not a broken page */ });
  };

  return (
    <div className={css.view}>
      <div className={css.bar}>
        {readable && (
          <>
            {!markdown && (
              <Chip selected={wrap} onClick={() => { setWrap(!wrap); }}>{RIGHTBAR_COPY['file.wrap']}</Chip>
            )}
            <Chip selected={copied} onClick={copy}>{copied ? RIGHTBAR_COPY['file.copied'] : RIGHTBAR_COPY['file.copy']}</Chip>
          </>
        )}
        <IconButton label={RIGHTBAR_COPY['file.reread']} size="sm" onClick={() => { send({ type: 'read_entry', path: doc.path }); }}>
          <RefreshGlyph />
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
      {readable && (markdown
        ? (
          <div className={css.markdown} data-readable="">
            <MarkdownText text={doc.text} />
          </div>
        )
        : (
          <div className={css.code} data-wrap={wrap || undefined}>
            {lines.map((text, index) => (
              <div key={index} className={css.line}>
                <span className={css.lineNo}>{index + 1}</span>
                <span className={css.lineText}>
                  {highlighted?.[index] !== undefined
                    ? highlighted[index].map((span, at) =>
                      span.kind === 'plain'
                        ? <span key={at}>{span.text}</span>
                        : <span key={at} style={{ color: TOKEN_VAR[span.kind] }}>{span.text}</span>,
                    )
                    : text}
                </span>
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}
