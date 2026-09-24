/**
 * Localized chrome for a Markdown document, forwarded to the fence copy
 * control (the harness `render.tsx`'s `MarkdownLabels` / `MarkdownCodeLabels`).
 * The harness carries a `footnotes` field too; this renderer has no footnote
 * section, so the vocabulary stops at the code block.
 */
export interface MarkdownCodeLabels {
  /** Copy-button idle label. */
  copyLabel: string;
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel: string;
}

export interface MarkdownLabels {
  code: MarkdownCodeLabels;
}

/** The surface's default chrome (the product's language). */
export const defaultMarkdownLabels: MarkdownLabels = {
  code: { copyLabel: '复制', copiedLabel: '已复制' },
};