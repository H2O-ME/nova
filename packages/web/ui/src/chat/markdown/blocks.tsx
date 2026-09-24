/**
 * Block tree → React elements (the block switch of the harness
 * `ui-primitives/src/markdown/render.tsx`), with the harness's DOM shapes kept
 * where a stylesheet or an owner depends on them:
 *
 *  - `md-table-wide` on a ≥4-column table (and its `tabIndex={0}`, which keeps
 *    the hover-revealed scrollbar keyboard-reachable);
 *  - `md-code-block` on every fence card (the markdown sheet's list rule
 *    exempts exactly that class);
 *  - task items: `contains-task-list` on the list, `task-list-item` on the
 *    item, and the disabled checkbox at the head of the item's paragraph;
 *  - the newline text nodes the replaced pipeline interleaved between block
 *    children (invisible between blocks, but they pin the same DOM the
 *    harness's parity fixtures pin).
 *
 * No HTML string and no `dangerouslySetInnerHTML`: raw HTML in the source is
 * text, `blocks.tsx` only ever builds elements.
 */
import { Fragment, createElement } from 'react';
import type { ReactNode } from 'react';
import { CodeBlock } from './CodeBlock.js';
import { parseInline } from './inline.js';
import { renderInline } from './inline-view.js';
import type { MdAlign, MdBlock, MdItem } from './parse.js';
import type { MarkdownLabels } from './labels.js';
import css from './MarkdownText.module.css';

/** One render pass's state (the harness `MarkdownRenderContext` subset this port has). */
export interface MarkdownRenderContext {
  /** Localized fence copy-button labels. */
  readonly labels: MarkdownLabels;
  /** The body is still growing (a streaming fence keeps its hook). */
  readonly streaming: boolean;
  /** Inside a blockquote's children: tables there always fill the quote's width. */
  readonly inBlockquote?: boolean;
}

/** Render top-level blocks (nothing to drop: every parsed block renders). */
export function renderMarkdownBlocks(blocks: readonly MdBlock[], context: MarkdownRenderContext): ReactNode[] {
  return interleave(blocks.map((block, index) => renderBlock(block, index, context)));
}

function renderBlock(block: MdBlock, key: number, context: MarkdownRenderContext): ReactNode {
  switch (block.t) {
    case 'p':
      return <p key={key}>{renderSource(block.lines)}</p>;
    case 'h':
      return createElement(`h${block.level}`, { key }, ...renderSource([block.text]));
    case 'hr':
      return <hr key={key} />;
    case 'quote':
      return (
        <blockquote key={key}>
          {wrapEdges(block.children.map((child, index) => renderBlock(child, index, { ...context, inBlockquote: true })))}
        </blockquote>
      );
    case 'list':
      return renderList(block, key, context);
    case 'table':
      return renderTable(block, key, context);
    case 'code':
      return renderCode(block.lang, block.code, key, context);
  }
}

/**
 * Render a paragraph's source lines. Newlines stay in the text run: the DOM's
 * whitespace collapsing turns them into spaces, exactly as the harness's
 * interleaved newline text nodes do.
 */
function renderSource(lines: readonly string[]): ReactNode[] {
  return renderInline(parseInline(lines.join('\n')));
}

/** The newline text nodes the replaced pipeline emitted between blocks. */
function interleave(nodes: readonly ReactNode[]): ReactNode[] {
  const out: ReactNode[] = [];
  for (const node of nodes) {
    if (out.length > 0) out.push('\n');
    out.push(node);
  }
  return out;
}

/** {@link interleave} plus the leading and trailing newline (hast's loose wrap). */
function wrapEdges(nodes: readonly ReactNode[]): ReactNode[] {
  if (nodes.length === 0) return [];
  return ['\n', ...interleave(nodes), '\n'];
}

function renderCode(lang: string | undefined, code: string, key: number, context: MarkdownRenderContext): ReactNode {
  // Parity: the replaced pipeline kept the stock <pre> for an empty fence.
  if (code === '') {
    return (
      <pre key={key}>
        <code className={lang === undefined ? undefined : `language-${lang}`} />
      </pre>
    );
  }
  return (
    <CodeBlock
      key={key}
      // The replaced hast pipeline appended one synthetic newline that
      // CodeBlock's display trim removes; feeding the bare value would make
      // that trim eat a REAL trailing blank line inside the fence instead.
      code={`${code}\n`}
      lang={lang}
      streaming={context.streaming}
      copyLabel={context.labels.code.copyLabel}
      copiedLabel={context.labels.code.copiedLabel}
    />
  );
}

/** Ordered/unordered list: a tight list unwraps its items' paragraphs. */
function renderList(block: Extract<MdBlock, { t: 'list' }>, key: number, context: MarkdownRenderContext): ReactNode {
  const tasks = block.items.some((item) => item.checked !== undefined);
  const tag = block.ordered ? 'ol' : 'ul';
  return createElement(
    tag,
    {
      key,
      ...(block.ordered && block.start !== 1 ? { start: block.start } : {}),
      ...(tasks ? { className: 'contains-task-list' } : {}),
    },
    ...interleave(block.items.map((item, index) => renderItem(item, block.loose, index, context))),
  );
}

function renderItem(item: MdItem, loose: boolean, key: number, context: MarkdownRenderContext): ReactNode {
  const parts: ReactNode[] = [];
  item.children.forEach((child, index) => {
    if (child.t !== 'p') {
      parts.push(renderBlock(child, index, context));
      return;
    }
    const inner = renderSource(child.lines);
    if (index === 0 && item.checked !== undefined) {
      inner.unshift(<input key="task-checkbox" type="checkbox" checked={item.checked} disabled />, ' ');
    }
    // mdast-util-to-hast parity: a tight item's paragraph is unwrapped, a
    // loose one keeps its <p>.
    parts.push(loose ? <p key={index}>{inner}</p> : <Fragment key={index}>{inner}</Fragment>);
  });
  if (parts.length === 0 && item.checked !== undefined) {
    parts.push(<p key="task-only"><input type="checkbox" checked={item.checked} disabled /></p>);
  }
  return (
    <li key={key} className={item.checked === undefined ? undefined : 'task-list-item'}>
      {interleave(parts)}
    </li>
  );
}

/**
 * A table: four or more columns read as a comparison matrix and keep their
 * natural width behind the `md-table-wide` hook; narrower tables (and any
 * table inside a blockquote) fill the column and wrap.
 */
function renderTable(block: Extract<MdBlock, { t: 'table' }>, key: number, context: MarkdownRenderContext): ReactNode {
  const wide = block.align.length >= 4 && context.inBlockquote !== true;
  return (
    <div
      key={key}
      className={wide ? `${css.tableScroll} md-table-wide` : `${css.tableScroll} ${css.tableFill}`}
      tabIndex={wide ? 0 : undefined}
    >
      <table>
        <thead>{renderRow(block.head, 'th', block.align, 0)}</thead>
        {block.rows.length > 0 && (
          <tbody>{block.rows.map((row, index) => renderRow(row, 'td', block.align, index + 1))}</tbody>
        )}
      </table>
    </div>
  );
}

/** With alignment present every row renders exactly one cell per column. */
function renderRow(cells: readonly string[], tag: 'th' | 'td', align: readonly MdAlign[], key: number): ReactNode {
  const out: ReactNode[] = [];
  for (let index = 0; index < align.length; index += 1) {
    const alignValue = align[index] ?? null;
    out.push(createElement(
      tag,
      // hast-util-to-jsx-runtime turned the deprecated align attribute into an
      // inline style; keep that DOM.
      { key: index, style: alignValue === null ? undefined : { textAlign: alignValue } },
      ...renderInline(parseInline(cells[index] ?? '')),
    ));
  }
  return <tr key={key}>{out}</tr>;
}