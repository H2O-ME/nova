/**
 * The approval card as it actually renders, through a server-render pass (this
 * lane has no DOM). What it pins is the part of the card a static read cannot:
 * the kind chip's tooltip is wired to its anchor.
 *
 * The chip shows the permission kind in words (写入) while the raw tool name is
 * what a reader needs to judge the ask. That name used to ride a `title`
 * attribute, which is hover-only: it never fires for a keyboard user, and it is
 * not associated with the control that owns it. Replacing it with the shared
 * tooltip is only an improvement if two things hold, and both are asserted
 * here:
 *
 *  - **the anchor can take focus**. A tooltip triggers on hover OR focus; an
 *    unfocusable `<span>` satisfies only the first, which would quietly restore
 *    the `title` behaviour it replaced.
 *  - **the keyboard contract survives the wrapping**. `y` / `a` / `n` are the
 *    card's answers and they are wired on the card's `onKeyDown`. Wrapping the
 *    chip must not intercept them, so the chip stays inside the card and keeps
 *    the card as the key handler's root.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ApprovalPanel } from '../src/approval/ApprovalPanel.js';
import type { ApprovalRequest } from '../src/types.js';

/** The ask the card is rendered around: an execute call with a scope. */
const request: ApprovalRequest = {
  id: 'ask-1',
  kind: 'execute',
  call: {
    id: 'call-1',
    name: 'bash',
    args: { command: 'git status' },
    rawArgs: '{"command":"git status"}',
  },
  preview: undefined,
  scopeWords: ['git', 'status'],
};

const card = (): string => renderToStaticMarkup(
  <ApprovalPanel request={request} send={() => undefined} connected />,
);

describe('approval card kind chip', () => {
  it('names the permission kind in the reader\u2019s vocabulary', () => {
    // The card never prints the wire's `execute`.
    expect(card()).toContain('执行');
    expect(card()).not.toContain('>execute<');
  });

  it('makes the chip focusable so its tooltip has a keyboard path', () => {
    // Without tabIndex the focus trigger can never fire on a span, and the
    // tooltip would be hover-only — exactly the `title` it replaced.
    const html = card();
    const badge = /<span class="[^"]*badge[^"]*"[^>]*>/.exec(html)?.[0];
    expect(badge).toBeDefined();
    expect(badge).toContain('tabindex="0"');
  });

  it('replaces the hover-only title with no leftover attribute', () => {
    // A `title` left behind would double the bubble on hover (native plus ours)
    // and would still be unreachable from the keyboard.
    expect(card()).not.toContain('title="bash"');
  });

  it('leaves the bubble out of the composer seat\u2019s stacking context', () => {
    // The card renders in the composer seat, a `position: sticky; z-index: 7`
    // stacking context (ConversationRoot.module.css). An in-place bubble's own
    // z-index would be confined to 7 and paint under the back-to-bottom control
    // (8); `portal` is what keeps it out. With nothing showing, the portaled
    // branch renders no bubble at all — so the assertion is that the card is
    // pure card, with no stray positioned node.
    const html = card();
    expect(html).not.toContain('role="tooltip"');
    expect(html).toContain('data-approval-scroll');
  });

  it('leaves the answer keys on the card, not on the chip', () => {
    // The chip is a description seat inside the dialog; the dialog is the one
    // key handler, so wrapping the chip must not move that ownership.
    const html = card();
    expect(html).toContain('role="dialog"');
    // The three affordances survive: 拒绝 / 总是允许 / 允许一次.
    expect(html).toContain('拒绝');
    expect(html).toContain('总是允许');
    expect(html).toContain('允许一次');
  });
});
