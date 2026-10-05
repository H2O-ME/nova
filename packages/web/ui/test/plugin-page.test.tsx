/**
 * The plugin page's three pure seams and one static render:
 *
 *  - `nextPluginRequestId` — the correlation-id source is page-global, not
 *    per-mount: a counter that restarts on remount made a slow reply to the
 *    PREVIOUS mount land on the fresh page (the reducer's stale-drop only
 *    isolates mounts when ids never repeat);
 *  - `parsePageDescriptor` — a plugin-owned descriptor crosses a JSON and a
 *    plugin boundary, so it is re-checked before the renderer indexes into it
 *    (`fields.map`, `options.map`); the validator is pinned on both sides
 *    (what it lets through, what it names);
 *  - `draftDirty` — "draft differs from the seed", including keys added or
 *    removed, so a pre-filled page does not read as edited on mount;
 *  - the failure card — a malformed descriptor renders as a card with the
 *    reason, not a thrown exception that takes the settings panel with it.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PluginPageSection } from '../src/settings/PluginPageSection.js';
import { parsePageDescriptor } from '../src/settings/page-descriptor.js';
import { nextPluginRequestId } from '../src/settings/plugin-request-id.js';
import { draftDirty } from '../src/settings/plugin-state.js';
import { SETTINGS_COPY } from '../src/settings/copy.js';

describe('nextPluginRequestId', () => {
  it('hands out strictly increasing ids across calls (no per-mount restart)', () => {
    const first = nextPluginRequestId();
    expect(nextPluginRequestId()).toBe(first + 1);
    expect(nextPluginRequestId()).toBe(first + 2);
  });
});

describe('parsePageDescriptor', () => {
  const valid = {
    title: 'QQ 通道',
    intro: '填凭据',
    guide: ['第一步', '第二步'],
    status: [{ label: '连接', value: '已连接', tone: 'ok' }],
    fields: [
      { key: 'appId', label: 'App ID', kind: 'text', value: 'x' },
      { key: 'secret', label: '密钥', kind: 'secret' },
      { key: 'mode', label: '模式', kind: 'select', options: [{ value: 'a', label: '甲' }] },
      { key: 'on', label: '开关', kind: 'switch' },
    ],
    actions: [{ id: 'probe', label: '探活', kind: 'plain' }],
  };

  it('lets a complete descriptor through unchanged', () => {
    const parsed = parsePageDescriptor(valid);
    expect(parsed).toEqual({ ok: true, page: valid });
  });

  it('refuses non-objects, arrays included', () => {
    expect(parsePageDescriptor('nope').ok).toBe(false);
    expect(parsePageDescriptor(null).ok).toBe(false);
    expect(parsePageDescriptor([valid]).ok).toBe(false);
  });

  it('refuses a non-string title/intro/note', () => {
    expect(parsePageDescriptor({ title: 3 }).ok).toBe(false);
    expect(parsePageDescriptor({ title: 't', intro: {} }).ok).toBe(false);
    expect(parsePageDescriptor({ title: 't', note: 1 }).ok).toBe(false);
  });

  it('refuses a malformed guide, status row, fields list, or actions list', () => {
    expect(parsePageDescriptor({ title: 't', guide: 'one' }).ok).toBe(false);
    expect(parsePageDescriptor({ title: 't', status: [{ label: 'L' }] }).ok).toBe(false);
    expect(parsePageDescriptor({ title: 't', fields: {} }).ok).toBe(false);
    expect(parsePageDescriptor({ title: 't', actions: 'go' }).ok).toBe(false);
  });

  it('names the offending field entry and its defect', () => {
    expect(parsePageDescriptor({ title: 't', fields: [{ label: '没有键', kind: 'text' }] })).toEqual({
      ok: false,
      reason: 'fields[0] 缺少 key',
    });
    expect(parsePageDescriptor({ title: 't', fields: [{ key: 'k', label: 'L', kind: 'slider' }] })).toEqual({
      ok: false,
      reason: 'fields[0] kind 不是四种可渲染类型之一',
    });
    expect(parsePageDescriptor({ title: 't', fields: [{ key: 'k', label: 'L', kind: 'select', options: 'a' }] })).toEqual({
      ok: false,
      reason: 'fields[0] options 必须是数组',
    });
    expect(parsePageDescriptor({ title: 't', fields: [{ key: 'k', label: 'L', kind: 'select', options: [{ value: 'a' }] }] })).toEqual({
      ok: false,
      reason: 'fields[0] options 条目缺少 value 或 label',
    });
    expect(parsePageDescriptor({ title: 't', actions: [{ id: '' }] })).toEqual({
      ok: false,
      reason: 'actions[0] 缺少 id 或 label',
    });
  });

  it('is tolerant on what the renderer only prints (unknown keys, tone)', () => {
    const loose = { title: 't', extra: 'ignored', status: [{ label: 'L', value: 'V', tone: 'sparkle' }] };
    expect(parsePageDescriptor(loose).ok).toBe(true);
  });
});

describe('draftDirty', () => {
  it('a draft equal to the seed is clean — including a pre-filled page', () => {
    const seeded = { appId: '123', mode: 'a' };
    expect(draftDirty(seeded, { appId: '123', mode: 'a' })).toBe(false);
  });

  it('a changed value, an added key, or a removed key is dirty', () => {
    const seeded = { appId: '123' };
    expect(draftDirty(seeded, { appId: '456' })).toBe(true);
    expect(draftDirty(seeded, { appId: '123', extra: 'x' })).toBe(true);
    expect(draftDirty({ appId: '123', mode: 'a' }, { appId: '123' })).toBe(true);
  });
});

describe('PluginPageSection / malformed descriptor', () => {
  function renderSection(result: unknown): string {
    return renderToStaticMarkup(
      <PluginPageSection
        plugin="demo"
        answer={{ id: 1, op: 'page', ok: true, result }}
        disabled={false}
        manageError={null}
        send={() => undefined}
        onEdit={() => undefined}
      />,
    );
  }

  it('renders the failure card with the reason instead of throwing', () => {
    const markup = renderSection({ title: 't', fields: {} });
    expect(markup).toContain(SETTINGS_COPY['pluginPage.invalid']);
    expect(markup).toContain('fields 必须是数组');
  });

  it('falls back to the plugin name for the heading and renders a valid page', () => {
    const bad = renderSection(42);
    expect(bad).toContain('demo');
    expect(renderSection({ title: '通道页' })).toContain('通道页');
  });
});
