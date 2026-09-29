/**
 * Localized chrome for a Markdown document, forwarded to the fence card's
 * toolbar (the harness `render.tsx`'s `MarkdownLabels` /
 * `MarkdownCodeLabels`). The harness carries a `footnotes` field too; this
 * renderer has no footnote section, so the vocabulary stops at the code block.
 */

/** The fence toolbar's language and wrapping vocabulary. */
export interface MarkdownCodeToolbarLabels {
  /** Title for an absent or unsupported language. */
  codeLabel: string;
  /** Action that enables wrapping. */
  wrapLabel: string;
  /** Action that preserves source columns with horizontal scrolling. */
  unwrapLabel: string;
}

export interface MarkdownCodeLabels {
  /** Copy-button idle label. */
  copyLabel: string;
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel: string;
  /** The toolbar's shared labels; omit to draw the plain text banner. */
  toolbarLabels?: MarkdownCodeToolbarLabels | undefined;
}

export interface MarkdownLabels {
  code: MarkdownCodeLabels;
}

/** The surface's default chrome (the product's language). */
export const defaultMarkdownLabels: MarkdownLabels = {
  code: {
    copyLabel: '复制',
    copiedLabel: '复制成功',
    toolbarLabels: {
      codeLabel: '代码块',
      wrapLabel: '自动换行',
      unwrapLabel: '取消自动换行',
    },
  },
};
