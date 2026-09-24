/**
 * Inline token tree → React elements (the phrasing branch of the harness
 * `render.tsx`). Elements only: every string in the tree is a text child, so
 * no HTML string ever reaches the DOM and provider output has no execution
 * path — the same architecture, one layer down from `blocks.tsx`.
 *
 * Ported details: the leading link-category glyph inside anchors and
 * URL-promoted inline code, `<br>` followed by a newline text node (the
 * harness's replaced-pipeline parity), external links opened in a new tab, and
 * an image that falls back to its alt text (or, failing that, its authored
 * destination) when the host refuses to load it.
 */
import { Fragment, useState } from 'react';
import type { ReactNode } from 'react';
import { UrlGlyph } from '../glyphs.js';
import type { InlineNode } from './inline.js';
import css from './MarkdownText.module.css';

/** Render an inline run; keys are positional (the tree is rebuilt per render). */
export function renderInline(nodes: readonly InlineNode[]): ReactNode[] {
  return nodes.map((node, index) => renderNode(node, index));
}

function renderNode(node: InlineNode, key: number): ReactNode {
  switch (node.t) {
    case 'text':
      return node.value;
    case 'br':
      // The replaced pipeline emitted a newline text node after each <br>.
      return <Fragment key={key}><br />{'\n'}</Fragment>;
    case 'code':
      return node.href === undefined
        ? <code key={key}>{node.value}</code>
        : <code key={key}>{renderAnchor(node.href, [node.value], 'link', true)}</code>;
    case 'strong':
      return <strong key={key}>{renderInline(node.children)}</strong>;
    case 'em':
      return <em key={key}>{renderInline(node.children)}</em>;
    case 'del':
      return <del key={key}>{renderInline(node.children)}</del>;
    case 'link':
      return renderAnchor(node.href, renderInline(node.children), key, node.glyph);
    case 'image':
      // A destination that fails the allowlist (a local path, a non-HTTP
      // scheme) keeps its authored alt text in the dim italic style the
      // harness gives it — never a broken image box.
      return node.url === undefined
        ? <span key={key} className={css.imageAlt}>{node.alt.length > 0 ? node.alt : node.destination}</span>
        : (
          <MarkdownImage
            key={`${key}:${node.url}`}
            src={node.url}
            alt={node.alt}
            destination={node.destination}
          />
        );
  }
}

/** An anchor over an allowlisted href; external links get the safe attributes. */
function renderAnchor(href: string, children: ReactNode[], key: number | string, glyph: boolean): ReactNode {
  const external = isExternal(href);
  return (
    <a key={key} href={href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
      {glyph && <UrlGlyph className={css.linkIcon} />}
      {children}
    </a>
  );
}

function isExternal(href: string): boolean {
  try {
    const protocol = new URL(href).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    // Only reachable with a forged href: `sanitizeUrl` already parsed it.
    return false;
  }
}

/** Failed loads retain the authored alt or destination (a new source remounts). */
function MarkdownImage({ src, alt, destination }: { src: string; alt: string; destination: string }): JSX.Element {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={css.imageAlt}>{alt.length > 0 ? alt : destination}</span>;
  return (
    <img
      className={css.image}
      src={src}
      alt={alt}
      onError={() => { setFailed(true); }}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}