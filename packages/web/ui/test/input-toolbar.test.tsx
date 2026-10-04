/**
 * The composer toolbar's access-tier control.
 *
 * One defect, one spec: **the tier is in the composer, in every variant.** The
 * access mode is a session-wide fact and the input box is where a reader reaches
 * for it; carrying it only in the hero is what pushed this product into bolting
 * the tier onto the session HEADER instead, where it read as a control that had
 * floated away from the box it belongs to.
 *
 * The execution mode has no chip here at all: which execution modes exist is the
 * providing plugin's own business, and that plugin renders its control on its own
 * settings page (see `PluginPageSection`). The host keeping a chip — and a frame —
 * for a plugin it is not supposed to know is the thing this file no longer pins.
 *
 * Rendered without a DOM (`renderToStaticMarkup`), like the rest of this lane.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InputToolbar } from '../src/composer/InputToolbar.js';
import { primarySeat } from '../src/composer/composer-text.js';

const toolbar = (over: Partial<Parameters<typeof InputToolbar>[0]> = {}): string =>
  renderToStaticMarkup(
    <InputToolbar
      disabled={false}
      variant="composer"
      approvalMode="read-only"
      model="deepseek-v4-flash"
      modelName="DeepSeek V4 Flash"
      modelSwitching
      catalog={null}
      menuOpen={false}
      onMenu={() => {}}
      seat={primarySeat({ running: false, disabled: false, draft: '' })}
      onPrimary={() => {}}
      send={() => {}}
      {...over}
    />,
  );

describe('InputToolbar access tier', () => {
  it('rides both variants', () => {
    // Structure, not copy: `data-mode-controls` carries the variant, so the
    // static lane reads which phase the row is in without matching class names.
    expect(toolbar({ variant: 'composer' })).toContain('data-mode-controls="composer"');
    const hero = toolbar({ variant: 'hero' });
    expect(hero).toContain('data-mode-controls="hero"');
    expect(hero).toContain('访问模式');
  });

  it('stays pickable while a turn is in flight', () => {
    // The tier is read at the NEXT approval and is not part of the cached prompt
    // prefix, so it is meant to be adjustable mid-run. A run is not a disabled
    // bar — the primary seat merely becomes Stop — so the tier stays live.
    const running = toolbar({ variant: 'hero', seat: primarySeat({ running: true, disabled: false, draft: '' }) });
    expect(anchorOf(running, '访问模式')).not.toContain('disabled');
  });

  it('still refuses the tier when the surface cannot accept input at all', () => {
    // No socket / a pending ask is a different fact from a running turn: there
    // the bar takes no input, so the tier is not live either.
    const offline = toolbar({ variant: 'hero', disabled: true });
    expect(anchorOf(offline, '访问模式')).toContain('disabled');
  });
});

/** The opening `<button …>` tag whose accessible name contains `name`. */
function anchorOf(html: string, name: string): string {
  const tags = html.match(/<button[^>]*>/g) ?? [];
  const found = tags.find((tag) => tag.includes(name));
  expect(found, `no button named ${name}`).toBeDefined();
  return found ?? '';
}
