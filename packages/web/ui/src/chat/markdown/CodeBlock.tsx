/**
 * Markdown fence card — port of the harness
 * `ui-primitives/src/markdown/CodeBlock.tsx`: a sticky banner carrying the
 * language label plus wrap and copy controls, and the source below. The harness
 * highlights through shiki's css-variables theme; this build has no shiki, so
 * `highlight.ts` produces the same `--shiki-*` runs and the plain `<pre>` arm
 * stays for languages it does not read (shiki's own no-grammar behavior).
 *
 * Stripped from the harness component (no DOM for them here): line numbers,
 * the streaming highlight session (per-delta re-tokenization is cheap enough at
 * this size, and the transcript memoizes a body on its text), the viewport
 * highlighter, and the `contentRef` scrollport seam. The harness routes its
 * labels through a `Tooltip` primitive; this port puts the same accessible name
 * on `aria-label` and the visual hint on `title`, which needs no portal.
 */
import { Fragment, memo, useCallback, useMemo, useState } from 'react';
import { writeClipboard } from '../../clipboard.js';
import { CheckGlyph, CopyGlyph, NoWrapGlyph14, WrapGlyph14 } from '../glyphs.js';
import { TOKEN_VAR, highlightLines, supportsHighlighting } from './highlight.js';
import type { MarkdownCodeLabels } from './labels.js';
import css from './CodeBlock.module.css';

export interface CodeBlockProps {
  /** The source text, rendered verbatim (a trailing newline is trimmed). */
  code: string;
  /** Grammar hint (the fence's info string); unknown = the plain `<pre>`. */
  lang?: string | undefined;
  /** Banner chrome: copy labels plus, when present, the toolbar vocabulary. */
  labels: MarkdownCodeLabels;
  /** Still growing (a streaming fence): a stable DOM hook, nothing more. */
  streaming?: boolean | undefined;
}

/**
 * The `pre` attributes shiki's HTML arm emits for the css-variables theme,
 * mirrored so a highlighted fence and a plain one keep the same box.
 */
const SHIKI_PRE_PROPS = {
  className: 'shiki css-variables',
  style: { backgroundColor: 'var(--shiki-background)', color: 'var(--shiki-foreground)' },
  tabIndex: 0,
} as const;

export const CodeBlock = memo(function CodeBlock({ code, lang, labels, streaming }: CodeBlockProps): JSX.Element {
  const trimmed = code.endsWith('\n') ? code.slice(0, -1) : code;
  const lines = useMemo(() => highlightLines(trimmed, lang), [trimmed, lang]);
  const [copied, setCopied] = useState(false);
  // Wrapping is the resting state; unwrapping is the reader asking for the
  // authored columns back (the harness's own default through `CodeToolbar`).
  const [wrapped, setWrapped] = useState(true);
  const toolbar = labels.toolbarLabels;

  const onCopy = useCallback((): void => {
    if (copied) return;
    void writeClipboard(trimmed).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => { setCopied(false); }, 1000);
    });
  }, [copied, trimmed]);

  const clipboardLabel = copied ? labels.copiedLabel : labels.copyLabel;
  const wrapLabel = wrapped ? toolbar?.unwrapLabel : toolbar?.wrapLabel;
  const banner = toolbar === undefined
    ? (
      <div className={css.banner} data-code-block-banner>
        <div className={css.infostring}>{lang ?? ''}</div>
        <div className={css.action}>
          <button type="button" className={css.copyButton} onClick={onCopy}>
            {clipboardLabel}
          </button>
        </div>
      </div>
    )
    : (
      <div className={css.header} data-code-block-banner>
        <div className={css.heading}>
          <span className={css.language}>{supportsHighlighting(lang) ? lang : toolbar.codeLabel}</span>
        </div>
        <div className={css.toolbarActions}>
          <button
            type="button"
            className={css.toolbarAction}
            aria-label={wrapLabel}
            aria-pressed={wrapped}
            title={wrapLabel}
            onClick={() => { setWrapped((value) => !value); }}
          >
            {wrapped ? <NoWrapGlyph14 /> : <WrapGlyph14 />}
          </button>
          <button
            type="button"
            className={css.toolbarAction}
            aria-label={clipboardLabel}
            title={clipboardLabel}
            onClick={onCopy}
          >
            {copied ? <CheckGlyph /> : <CopyGlyph />}
          </button>
        </div>
      </div>
    );

  return (
    <div
      className={`${css.block} md-code-block`}
      data-streaming={streaming === true ? '' : undefined}
      data-code-wrap={toolbar === undefined ? undefined : wrapped}
    >
      {/* These paired attributes are stable semantic hooks for owner styling. */}
      <div className={css.bannerWrap}>{banner}</div>
      <div className={css.content} data-code-block-content>
        {lines === undefined
          ? <pre className={css.plain}><code>{trimmed}</code></pre>
          : (
            <pre {...SHIKI_PRE_PROPS}>
              <code>
                {lines.map((line, index) => (
                  <Fragment key={index}>
                    {index > 0 && '\n'}
                    <span className="line">
                      {line.map((span, spanIndex) => (
                        span.kind === 'plain'
                          ? <Fragment key={spanIndex}>{span.text}</Fragment>
                          : <span key={spanIndex} style={{ color: TOKEN_VAR[span.kind] }}>{span.text}</span>
                      ))}
                    </span>
                  </Fragment>
                ))}
              </code>
            </pre>
          )}
      </div>
    </div>
  );
});
