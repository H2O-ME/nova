/**
 * The composer toolbar's phase rule and its access-tier control.
 *
 * Two defects, one spec:
 *
 *  - **Both chips are in the composer, in every variant.** The access tier and
 *    the execution mode are session-wide facts, and the input box is where a
 *    reader reaches for them. Carrying them only in the hero is what pushed this
 *    product into bolting the tier onto the session HEADER instead, where it read
 *    as a control that had floated away from the box it belongs to.
 *  - **Their locks differ on purpose.** The access tier is read at the NEXT
 *    approval and is not part of the cached prompt prefix, so it stays pickable
 *    mid-run — and "change the permission level after the session started" is
 *    exactly the capability that was missing. The execution mode re-rosters the
 *    tool table the running request was built on, so the host refuses it mid-run
 *    and the chip carries that lock.
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
      running={false}
      variant="composer"
      approvalMode="read-only"
      codeMode="native"
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

describe('InputToolbar mode chips', () => {
  it('drops the execution mode once the session has started', () => {
    // The execution mode picks the TOOLSET, i.e. part of the cached prefix, so it
    // is settled for a session that already has a transcript: a chip there could
    // only offer a pick the server refuses. The access tier stays, because it is
    // read fresh at the NEXT approval and is meant to be adjustable mid-run.
    const html = toolbar({ variant: 'composer' });
    expect(html).toContain('data-mode-controls="composer"');
    expect(html).toContain('访问模式');
    expect(html).not.toContain('执行模式');
  });

  it('carries both mode selectors before the session starts', () => {
    const html = toolbar({ variant: 'hero' });
    // Structure, not copy: the hero must expose the group and both controls.
    expect(html).toContain('data-mode-controls="hero"');
    expect(html).toContain('访问模式');
    expect(html).toContain('执行模式');
  });

  it('leaves the access tier pickable while a turn is in flight', () => {
    // `disabled` stays false for the approval chip mid-run; only the execution
    // mode is locked, because re-rostering the tool table would split the turn.
    const running = toolbar({ variant: 'hero', running: true });
    const approval = anchorOf(running, '访问模式');
    const code = anchorOf(running, '执行模式');
    expect(approval).not.toContain('disabled');
    expect(code).toContain('disabled');
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
