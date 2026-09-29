/**
 * A component lane for `shell/AppFrame.tsx`, asserted without a DOM (a
 * server-render pass plus the shipped stylesheet text).
 *
 * The one contract here is the track easing, and it is behavioural rather than
 * decorative: a collapsed column that eases on every width change looks right
 * in a screenshot and is visibly wrong in the hand — the eased track chases the
 * live window edge, so the centre column rubber-bands through a window resize
 * and lags the drag handle during a drag. The reference scopes the transition
 * to a discrete toggle and marks that toggle on the element; this pins both
 * halves so neither can be dropped independently:
 *
 *  - the stylesheet must not transition `.frame` unconditionally — only the
 *    `[data-animating]` state eases, and dragging/fullscreen/reduced-motion all
 *    turn it off;
 *  - the handle rides the same gate, for the same reason;
 *  - a frame rendered at rest must not carry the attribute, or every frame
 *    would ease everything.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppFrame } from '../src/shell/AppFrame.js';
import { initialLayout } from '../src/shell/layout-store.js';

const sheet = readFileSync(
  fileURLToPath(new URL('../src/shell/AppFrame.module.css', import.meta.url)),
  'utf8',
).replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations of one exact selector, as written. */
const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(sheet)?.[1] ?? '';
};

const frame = (): string => renderToStaticMarkup(
  <AppFrame
    layout={{ ...initialLayout(1440), sidebar: 280 }}
    onViewportWidth={() => undefined}
    onSidebarWidth={() => undefined}
    onRightbarWidth={() => undefined}
    dragging={false}
    onDragChange={() => undefined}
    sidebar={() => <span>侧栏</span>}
    center={<span>正文</span>}
  />,
);

describe('AppFrame track easing', () => {
  it('eases the tracks only in the animating state', () => {
    // Unconditional easing is the defect: it makes every viewport-driven width
    // change animate, and the centre column visibly chases the window edge.
    expect(rule('.frame')).not.toContain('transition');
    expect(rule('.frame[data-animating]'))
      .toContain('transition: grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out)');
    expect(rule('.frame[data-dragging]')).toContain('transition: none');
  });

  it('keeps the handle on the same gate', () => {
    expect(rule('.handle')).not.toContain('transition');
    expect(rule('.frame[data-animating] .handle'))
      .toContain('transition: left var(--ds-transition-duration-slow) var(--ds-ease-in-out)');
    expect(rule('.frame[data-dragging] .handle')).toContain('transition: none');
  });

  it('cancels the eased state where the frame cannot show it', () => {
    // Fullscreen covers the columns while they enter or exit, and the
    // reduced-motion reader asked for no motion at all.
    expect(rule('.frame[data-rightbar-fullscreen],\n.frame[data-rightbar-fullscreen] .handle,\n.frame[data-rightbar-instant],\n.frame[data-rightbar-instant] .handle'))
      .toContain('transition: none');
    expect(sheet).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.frame\[data-animating\][\s\S]*?transition: none/);
    expect(sheet).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.frame\[data-animating\] \.handle[\s\S]*?transition: none/);
  });

  it('renders a frame at rest without the animating marker', () => {
    const html = frame();
    // The attribute is the gate; a frame that always carried it would ease
    // every steady-state width change this component renders. The handle is
    // asserted alongside it so this is a frame and not an empty string.
    expect(html).not.toContain('data-animating');
    expect(html).toContain('data-side="sidebar"');
    expect(html).toContain('grid-template-columns:280px');
  });
});
