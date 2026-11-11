/**
 * The provider card editor's static contract.
 *
 * It was a ~200-line closure inside `ProviderSection` and is now its own
 * component. The risk this lane pins is the one a move of that size actually
 * carries: a markup detail dropped while relocating the JSX. The `data-*`
 * handles below are not decoration — the roster keys off them, and the
 * save/cancel pair is how a reader acts on ONE card while the wire protocol
 * writes the whole list.
 *
 * Two behaviors get the most attention because both are silent when wrong:
 *
 *  - save is disabled unless this card holds a draft (a stored card with no
 *    edits has nothing to write) or the card is new;
 *  - a refusal frame WITHOUT a detail line renders the box and no detail row —
 *    flattening the message to `''` would add an empty `<p>` and change the
 *    card's height for a probe that failed silently.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProviderCardEditor } from '../src/settings/ProviderCardEditor.js';
import type { ProviderCardEditorProps } from '../src/settings/ProviderCardEditor.js';
import type { ProviderDraft } from '../src/settings/provider-draft.js';

const ROW: ProviderDraft = {
  id: 'p1',
  name: '端点在役',
  baseURL: 'https://api.example.test/v1',
  apiKey: '',
  temperature: '',
  maxTokens: '',
  contextWindow: '',
  models: [{ id: 'm1' }],
};

function render(overrides: Partial<ProviderCardEditorProps> = {}): string {
  const props: ProviderCardEditorProps = {
    row: ROW,
    isNew: false,
    hasKey: true,
    problem: null,
    dirty: true,
    probePending: false,
    probeFail: null,
    manualModel: '',
    onEdit: () => {},
    onManualModel: () => {},
    onAddModel: () => {},
    onRemoveModel: () => {},
    onProbe: () => {},
    onSave: () => {},
    onCancel: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(<ProviderCardEditor {...props} />);
}

describe('provider card editor', () => {
  it('keeps the data handles the roster and the save path key off', () => {
    const html = render();
    expect(html).toContain('data-provider-save-card="p1"');
    expect(html).toContain('data-provider-cancel="p1"');
    expect(html).toContain('data-provider-probe="p1"');
    expect(html).toContain('data-provider-model-remove="m1"');
    expect(html).toContain('data-provider-model-add');
  });

  it('disables save when the stored card holds no draft, enables it for a new one', () => {
    // Nothing changed on a stored card: the wire write would be a no-op.
    expect(render({ dirty: false, isNew: false })).toMatch(/data-provider-save-card="p1"[^>]*disabled/);
    // The add-card has no stored counterpart, so its values are always a write.
    expect(render({ dirty: false, isNew: true })).not.toMatch(/data-provider-save-card="p1"[^>]*disabled/);
    // An unsavable draft keeps it disabled even when edited.
    expect(render({ dirty: true, problem: '温度超出范围' })).toMatch(/data-provider-save-card="p1"[^>]*disabled/);
  });

  it('renders a refusal box with no detail row when the frame carried no message', () => {
    const bare = render({ probeFail: {} });
    expect(bare).toContain('data-provider-pool-fail="p1"');
    expect(bare).not.toContain('class="_error_');

    const detailed = render({ probeFail: { message: '连接超时' } });
    expect(detailed).toContain('连接超时');
  });
});
