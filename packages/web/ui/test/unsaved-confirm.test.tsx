/**
 * A server-render pass over the unsaved-edits confirm (no DOM, no portal —
 * the body is exported portal-free for exactly this lane, the same shape
 * SettingsDialog uses).
 *
 * What is pinned is the safety geometry, not the paint: the dialog is
 * `alertdialog`-named, its body names the section holding the edits, and the
 * autofocus mark sits on STAY — a stray Enter must land on the choice that
 * keeps the operator's work, never on the discard button.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { UnsavedConfirmDialogBody } from '../src/settings/UnsavedConfirmDialog.js';

function markup(): string {
  return renderToStaticMarkup(
    <UnsavedConfirmDialogBody section="QQ 通道" onConfirm={() => undefined} onClose={() => undefined} />,
  );
}

describe('UnsavedConfirmDialogBody', () => {
  it('names the dialog and the section holding the edits', () => {
    const html = markup();
    expect(html).toContain('alertdialog');
    expect(html).toContain('未保存的修改');
    expect(html).toContain('「QQ 通道」还有未保存的修改');
  });

  it('puts the autofocus mark on 留在本页, not on 放弃修改并离开', () => {
    const html = markup();
    expect(html).toContain('data-modal-autofocus');
    const stay = html.indexOf('留在本页');
    const discard = html.indexOf('放弃修改并离开');
    expect(stay).toBeGreaterThan(-1);
    expect(discard).toBeGreaterThan(-1);
    expect(html.lastIndexOf('data-modal-autofocus', stay)).toBeGreaterThan(-1);
    expect(html.indexOf('data-modal-autofocus', discard)).toBe(-1);
  });
});
