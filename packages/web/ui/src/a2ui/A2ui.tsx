/**
 * The A2UI renderer: the BASIC catalog's components drawn with Nova's tokens.
 *
 * One surface = one component table + one local data model. Inputs write the
 * model in place (A2UI's local two-way binding: no round-trip until an action),
 * and a Button resolves its `action.event` context against the CURRENT model
 * before submitting — so the agent receives the values the user sees, not the
 * values the model was created with.
 *
 * Unknown components and unsupported function calls degrade quietly: the card
 * draws what it can rather than failing the whole tool result.
 */
import { useMemo, useState } from 'react';
import type { A2uiComponent, A2uiMessage } from '@nova-agent/core';
import { useA2uiSubmit, type A2uiSubmit } from './action-context.js';
import {
  actionOf, asText, bindPath, buildSurfaces, childIds, resolveValue, setAtPath, templateRows, type A2uiSurface,
} from './surface.js';
import css from './A2ui.module.css';

export interface A2uiViewProps {
  messages: readonly A2uiMessage[];
}

/** The result card's body: every surface the tool call created, in order. */
export function A2uiView({ messages }: A2uiViewProps): JSX.Element | null {
  const surfaces = useMemo(() => buildSurfaces(messages), [messages]);
  if (surfaces.length === 0) return null;
  return (
    <div className={css.root}>
      {surfaces.map((surface) => <SurfaceView key={surface.id} surface={surface} />)}
    </div>
  );
}

function SurfaceView({ surface }: { surface: A2uiSurface }): JSX.Element {
  const submit = useA2uiSubmit();
  const [data, setData] = useState<unknown>(surface.data);
  const write = (path: string, value: unknown): void => { setData((current: unknown) => setAtPath(current, path, value)); };
  return (
    <div className={css.surface} data-a2ui-surface={surface.id}>
      {node('root', surface, data, write, submit)}
    </div>
  );
}

function node(
  id: string,
  surface: A2uiSurface,
  data: unknown,
  write: (path: string, value: unknown) => void,
  submit: A2uiSubmit | null,
  scope: unknown = data,
  depth = 0,
): JSX.Element | null {
  if (depth > 64) return null;
  const component = surface.components.get(id);
  if (component === undefined) return null;
  const next = (childId: string): JSX.Element | null => node(childId, surface, data, write, submit, scope, depth + 1);
  const children = (): (JSX.Element | null)[] => childIds(component).map((childId, index) => (
    <FragmentKey key={`${childId}:${String(index)}`}>{next(childId)}</FragmentKey>
  ));
  const value = (prop: string): unknown => resolveValue(component[prop], data, scope);

  switch (component.component) {
    case 'Text': {
      const variant = typeof component['variant'] === 'string' ? component['variant'] : 'body';
      return <p className={css.text} data-variant={variant}>{asText(value('text'))}</p>;
    }
    case 'Column':
      return <div className={css.column} data-align={alignOf(component)}>{children()}</div>;
    case 'Row':
      return <div className={css.row} data-justify={justifyOf(component)} data-align={alignOf(component)}>{children()}</div>;
    case 'List': {
      const rows = templateRows(component, data);
      if (rows.length > 0) {
        return (
          <div className={css.list} data-direction={directionOf(component)}>
            {rows.map((row) => (
              <FragmentKey key={row.key}>
                {node(row.id, surface, data, write, submit, row.scope, depth + 1)}
              </FragmentKey>
            ))}
          </div>
        );
      }
      return <div className={css.list} data-direction={directionOf(component)}>{children()}</div>;
    }
    case 'Card':
      return <section className={css.card}>{children()}</section>;
    case 'Divider':
      return <hr className={css.divider} data-axis={component['axis'] === 'vertical' ? 'vertical' : 'horizontal'} />;
    case 'Image': {
      const url = safeUrl(asText(value('url')));
      if (url === undefined) return null;
      return <img className={css.image} src={url} alt={asText(value('description'))} loading="lazy" />;
    }
    case 'Video': {
      const url = safeUrl(asText(value('url')));
      if (url === undefined) return null;
      return <video className={css.media} src={url} controls playsInline preload="metadata" />;
    }
    case 'AudioPlayer': {
      const url = safeUrl(asText(value('url')));
      if (url === undefined) return null;
      return <audio className={css.media} src={url} controls preload="metadata" />;
    }
    case 'Icon':
      return <span className={css.icon} aria-label={asText(value('name'))} title={asText(value('name'))} />;
    case 'Button': {
      const action = actionOf(component, data, scope);
      const label = node(childIds(component)[0] ?? '', surface, data, write, submit, scope, depth + 1);
      return (
        <button
          type="button"
          className={css.button}
          data-variant={typeof component['variant'] === 'string' ? component['variant'] : 'default'}
          disabled={action === undefined || submit === null}
          title={action === undefined ? '这个按钮没有绑定动作' : undefined}
          onClick={() => {
            if (action === undefined || submit === null) return;
            submit({
              ...action,
              surfaceId: surface.id,
              sourceComponentId: component.id,
              timestamp: new Date().toISOString(),
              ...(surface.sendDataModel ? { dataModel: data } : {}),
            });
          }}
        >
          {label ?? asText(value('text'))}
        </button>
      );
    }
    case 'TextField': {
      const path = bindPath(component['value']);
      const current = asText(value('value'));
      const variant = typeof component['variant'] === 'string' ? component['variant'] : 'shortText';
      const multiline = variant === 'longText';
      return (
        <label className={css.field}>
          <span className={css.fieldLabel}>{asText(value('label'))}</span>
          {multiline ? (
            <textarea
              className={css.input}
              value={current}
              rows={3}
              onChange={(event) => { if (path !== undefined) write(path, event.target.value); }}
            />
          ) : (
            <input
              className={css.input}
              type={variant === 'number' ? 'number' : variant === 'obscured' ? 'password' : 'text'}
              value={current}
              onChange={(event) => {
                if (path === undefined) return;
                write(path, variant === 'number' ? Number(event.target.value) : event.target.value);
              }}
            />
          )}
        </label>
      );
    }
    case 'CheckBox': {
      const path = bindPath(component['value']);
      const checked = value('value') === true;
      return (
        <label className={css.choice}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => { if (path !== undefined) write(path, event.target.checked); }}
          />
          <span>{asText(value('label'))}</span>
        </label>
      );
    }
    case 'ChoicePicker':
      return (
        <ChoicePickerView component={component} data={data} scope={scope} write={write} />
      );
    case 'Slider': {
      const path = bindPath(component['value']);
      const current = Number(value('value') ?? 0);
      const min = Number(value('min') ?? 0);
      const max = Number(value('max') ?? 100);
      return (
        <label className={css.field}>
          <span className={css.fieldLabel}>{asText(value('label'))}</span>
          <span className={css.sliderRow}>
            <input
              className={css.slider}
              type="range"
              min={min}
              max={max}
              value={current}
              onChange={(event) => { if (path !== undefined) write(path, Number(event.target.value)); }}
            />
            <output className={css.sliderValue}>{String(current)}</output>
          </span>
        </label>
      );
    }
    case 'DateTimeInput': {
      const path = bindPath(component['value']);
      const date = component['enableDate'] !== false;
      const time = component['enableTime'] === true;
      return (
        <label className={css.field}>
          {component['label'] !== undefined && <span className={css.fieldLabel}>{asText(value('label'))}</span>}
          <input
            className={css.input}
            type={date && time ? 'datetime-local' : time ? 'time' : 'date'}
            value={asText(value('value'))}
            onChange={(event) => { if (path !== undefined) write(path, event.target.value); }}
          />
        </label>
      );
    }
    case 'Tabs':
      return <TabsView component={component} surface={surface} data={data} write={write} submit={submit} scope={scope} depth={depth} />;
    case 'Modal':
      // A modal is a button-triggered dialog. The transcript is not a window
      // manager: draw the content inline, which is the same information without
      // stealing focus from the composer.
      return <div className={css.modal}>{children()}</div>;
    default:
      return null;
  }
}

/** A React key without adding a wrapper element. */
function FragmentKey({ children }: { children: JSX.Element | null }): JSX.Element {
  return <>{children}</>;
}

function ChoicePickerView({ component, data, scope, write }: {
  component: A2uiComponent;
  data: unknown;
  scope: unknown;
  write: (path: string, value: unknown) => void;
}): JSX.Element {
  const path = bindPath(component['value']);
  const raw = resolveValue(component['value'], data, scope);
  const selected = Array.isArray(raw) ? raw.map((item) => asText(item)) : raw === undefined || raw === null ? [] : [asText(raw)];
  const options = Array.isArray(component['options']) ? component['options'] : [];
  const multiple = component['variant'] === 'multipleSelection';
  const toggle = (optionValue: string, on: boolean): void => {
    if (path === undefined) return;
    if (multiple) {
      const next = on ? [...selected, optionValue] : selected.filter((item) => item !== optionValue);
      write(path, next);
    } else {
      // The catalog's single-selection value is one string, not an array.
      write(path, on ? optionValue : '');
    }
  };
  return (
    <fieldset className={css.field}>
      {component['label'] !== undefined && <legend className={css.fieldLabel}>{asText(resolveValue(component['label'], data, scope))}</legend>}
      <div className={css.options} data-style={component['displayStyle'] === 'chips' ? 'chips' : 'checkbox'}>
        {options.map((option, index) => {
          if (typeof option !== 'object' || option === null) return null;
          const record = option as Record<string, unknown>;
          const optionValue = asText(resolveValue(record['value'], data, scope));
          const label = asText(resolveValue(record['label'], data, scope));
          const checked = selected.includes(optionValue);
          return (
            <label key={`${optionValue}:${String(index)}`} className={css.choice}>
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={component.id}
                checked={checked}
                onChange={(event) => { toggle(optionValue, event.target.checked); }}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function TabsView({ component, surface, data, write, submit, scope, depth }: {
  component: A2uiComponent;
  surface: A2uiSurface;
  data: unknown;
  write: (path: string, value: unknown) => void;
  submit: A2uiSubmit | null;
  scope: unknown;
  depth: number;
}): JSX.Element {
  const tabs = Array.isArray(component['tabs']) ? component['tabs'] : [];
  const [active, setActive] = useState(0);
  const current = tabs[Math.min(active, tabs.length - 1)];
  const child = typeof current === 'object' && current !== null && typeof (current as Record<string, unknown>)['child'] === 'string'
    ? (current as Record<string, unknown>)['child'] as string
    : undefined;
  return (
    <div className={css.tabs}>
      <div className={css.tabRow} role="tablist">
        {tabs.map((tab, index) => {
          const record = typeof tab === 'object' && tab !== null ? tab as Record<string, unknown> : {};
          return (
            <button
              key={`${asText(record['title'])}:${String(index)}`}
              type="button"
              role="tab"
              aria-selected={index === active}
              className={css.tab}
              onClick={() => { setActive(index); }}
            >
              {asText(resolveValue(record['title'], data, scope))}
            </button>
          );
        })}
      </div>
      <div className={css.tabBody}>
        {child !== undefined ? node(child, surface, data, write, submit, scope, depth + 1) : null}
      </div>
    </div>
  );
}

function alignOf(component: A2uiComponent): string {
  const align = component['align'];
  return typeof align === 'string' ? align : 'stretch';
}

function justifyOf(component: A2uiComponent): string {
  const justify = component['justify'];
  return typeof justify === 'string' ? justify : 'start';
}

function directionOf(component: A2uiComponent): string {
  return component['direction'] === 'horizontal' ? 'horizontal' : 'vertical';
}

/** Only browser-safe image sources: no `javascript:` or scheme-less fetches. */
function safeUrl(url: string): string | undefined {
  const trimmed = url.trim();
  if (/^https?:\/\//iu.test(trimmed) || /^data:image\//iu.test(trimmed)) return trimmed;
  return undefined;
}
