/**
 * The settings modal: full-viewport mask + centered 800×800 panel with the
 * section nav rail.
 *
 * The shell decides nothing about the sections: each caller passes its real
 * ones (label + icon + content), and the rail renders whatever it is given — a
 * caller registers several today (通用设置 / 模型 / 内置插件 in `App.tsx`), and
 * adding another is a row, not a redesign.
 *
 * Close paths are the reference's three: the header button, a mask click, and
 * Escape. The Escape/Tab/focus lifetime is the reference's `useModalLayer`
 * (`shell/modal-layer.ts`): the dialog registers on the document's modal
 * stack, so only the top layer closes on Escape — a menu open inside the
 * dialog handles the same press during capture first and `preventDefault`s
 * it, which this layer reads as the menu's — Tab cycles inside the panel
 * (portaled menus keep their own traversal), focus enters on the active nav
 * row without a ring and returns to the invoker on unmount.
 */
import { useState, useId, useRef, useEffect } from 'react';
import type { MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { useModalLayer } from '../shell/modal-layer.js';
import { ArrowLeftIcon, SearchIcon } from '../icons.js';
import { cx } from '../composer/cx.js';
import { UnsavedConfirmDialog } from './UnsavedConfirmDialog.js';
import { isDesktopShell } from '../shell/desktop-shell.js';
import { SIDEBAR_COPY } from '../sidebar/view.js';
import css from './SettingsPanel.module.css';

/** One nav row and its content: a section this product actually registers. */
export interface SettingsSection {
  id: string;
  label: string;
  icon: JSX.Element;
  content: JSX.Element;
  /**
   * The nav group this section belongs to (`基础设置` / `Agent 能力`). The
   * reference's rail groups its rows under quiet subject lines; a rail of ten
   * flat rows states no order at all. An absent group renders ungrouped, so a
   * caller that predates groups keeps working.
   */
  group?: string;
  /**
   * The section holds unsaved edits. Switching away (or closing the panel)
   * unmounts the content, so the panel asks first instead of discarding
   * silently — the section reports this through its own state (a plugin page
   * knows its draft; the panel knows nothing about what the fields mean).
   */
  dirty?: boolean;
}

/** What the reader asked to leave TO — another section, or out of the panel. */
export type LeaveIntent = { kind: 'switch'; id: string } | { kind: 'close' };

export interface SettingsDialogProps {
  /** The page's name (`设置`), used as the accessible title. */
  title: string;
  sections: readonly SettingsSection[];
  /** The nav row the dialog is on (undefined falls back to the first). */
  activeId?: string | undefined;
  onSelect: (id: string) => void;
  onClose: () => void;
  /**
   * The running version (`ready.version`), stated at the nav column's foot.
   *
   * It lives here rather than beside the hero headline: a build number is an
   * answer to "which version am I on", which is a settings question, not
   * something the empty column is asking the reader to think about. Optional —
   * a host that sent none renders no line at all.
   */
  version?: string | undefined;
  /** The dialog element, for the wrapper's focus and Escape lifetime. */
  panelRef?: MutableRefObject<HTMLDivElement | null> | undefined;
}

/**
 * The dialog markup, portal-free so the static lane can walk it without a
 * document.
 * @param props - see SettingsDialogProps.
 * @returns the dialog element tree.
 */
export function SettingsDialog({
  title,
  sections,
  activeId,
  onSelect,
  onClose,
  version,
  panelRef,
}: SettingsDialogProps): JSX.Element {
  const active = sections.find((section) => section.id === activeId) ?? sections[0];
  const titleId = useId();
  // The rail's filter. Case-folded substring over the row's own label — the
  // only text the rail prints — and it never touches the page on the right.
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();
  const visible = needle === ''
    ? sections
    : sections.filter((section) => section.label.toLocaleLowerCase().includes(needle));
  // Registration order is the rail's order: consecutive rows sharing a group
  // name stack under ONE heading, so a caller can add a page to an existing
  // group by naming it, and an ungrouped section keeps its flat row.
  const groups: { name: string | undefined; rows: SettingsSection[] }[] = [];
  for (const section of visible) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.name === section.group) last.rows.push(section);
    else groups.push({ name: section.group, rows: [section] });
  }
  // The scroll column is the panel's own and survives a switch: landing on a
  // short page from a long one kept the old offset, and the new page looked
  // like it had not switched. Every switch lands at the top.
  const optionsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    optionsRef.current?.scrollTo({ top: 0 });
  }, [active?.id]);
  // Narrow rail: the reference replaces the filter field with a 40px search
  // button (`max-lg` variant of its `SettingsSearch`); pressing it here opens
  // the same input as a small floating field over the rail.
  const [railSearchOpen, setRailSearchOpen] = useState(false);
  const railSearchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (railSearchOpen) railSearchRef.current?.focus();
  }, [railSearchOpen]);
  return (
    <div
      className={css.overlay}
      role="presentation"
      {...(isDesktopShell() ? { 'data-desktop': '' } : {})}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={css.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <nav
          className={css.nav}
          aria-label={title}
          {...(railSearchOpen ? { 'data-search-open': '' } : {})}
        >
          {/* The reference's settings rail starts below a 48px drag strip
              (`h-12 [app-region:drag]`), not at the window's top edge — its
              window controls live in that band. */}
          <div className={css.navTop} data-tauri-drag-region="" />
          {/* The reference's settings page is a full-window view whose only
              way out is a ghost row at the top of its own nav rail (`← 返回
              工作区`), not a × in a dialog corner. */}
          <button type="button" className={css.back} onClick={onClose}>
            <ArrowLeftIcon />
            <span className={css.backLabel}>返回工作区</span>
          </button>
          <div className={css.navTitle} id={titleId} tabIndex={-1}>{title}</div>
          {/* The rail's own filter (the reference's `SettingsSearch`): it sits
              between the way out and the grouped rows, at the input size every
              searchable surface uses. It filters the ROWS, not the page — a
              query only ever narrows what the rail offers, so landing on a
              section is the same click as without it. */}
          <div className={css.navSearch}>
            <button
              type="button"
              className={css.navSearchToggle}
              aria-label="搜索设置"
              aria-expanded={railSearchOpen}
              onClick={() => { setRailSearchOpen((open) => !open); }}
            >
              <SearchIcon />
            </button>
            <SearchIcon className={css.navSearchIcon} />
            <input
              ref={railSearchRef}
              type="search"
              className={css.navSearchInput}
              value={query}
              placeholder="搜索设置"
              aria-label="搜索设置"
              data-modal-escape-owner
              onChange={(event) => { setQuery(event.currentTarget.value); }}
              onKeyDown={(event) => {
                if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
                event.stopPropagation();
                if (query === '') {
                  setRailSearchOpen(false);
                  return;
                }
                setQuery('');
              }}
            />
          </div>
          <div className={css.navList}>
            {groups.map((group) => (
              <div
                key={group.name ?? ''}
                className={css.navGroup}
                role="group"
                {...(group.name !== undefined ? { 'aria-label': group.name } : {})}
              >
                {group.name !== undefined && (
                  <div className={css.navGroupLabel}>{group.name}</div>
                )}
                {group.rows.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    className={cx(css.navCell, section.id === active?.id && css.active)}
                    aria-current={section.id === active?.id ? 'true' : undefined}
                    // The modal layer's entry focus lands here (the reference's
                    // `data-modal-autofocus` on the active nav row).
                    data-modal-autofocus={section.id === active?.id ? '' : undefined}
                    onClick={() => { onSelect(section.id); }}
                  >
                    {section.icon}
                    <span className={css.navLabel}>{section.label}</span>
                  </button>
                ))}
              </div>
            ))}
            {groups.length === 0 && (
              <div className={css.navEmpty}>没有匹配的设置</div>
            )}
          </div>
          {/* The rail's foot wears the product identity — the reference's own
              footer shape (a 32px avatar and the name in 14/600 on the column's
              floor). Nova has no account, so the avatar is the fallback letter;
              the built version rides the same row as quiet reference data
              instead of a line of its own. */}
          <div className={css.navIdentity}>
            <span className={css.navAvatar} aria-hidden="true">
              {SIDEBAR_COPY.brand.slice(0, 1)}
            </span>
            <span className={css.navName}>{SIDEBAR_COPY.brand}</span>
            {version !== undefined && version !== '' && (
              <span className={css.navVersion}>v{version}</span>
            )}
          </div>
        </nav>
        <div className={css.content}>
          {/* The reference's in-panel top strip: 48px of drag area, no words.
              The page is NAMED by the section title below, so a breadcrumb here
              only repeated it. */}
          <div className={css.header} data-tauri-drag-region="" />
          <div className={css.options} ref={optionsRef}>
            {/* The section's own name over its column, the reference's
                `text-ui-settings-title` block: without it the rail was the
                only place a section was ever named. */}
            {active !== undefined && <h2 className={css.pageTitle}>{active.label}</h2>}
            {active?.content}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface SettingsPanelProps {
  /** The page's name (`设置`), used as the accessible title. */
  title: string;
  sections: readonly SettingsSection[];
  /** The running version, stated at the nav column's foot (see SettingsDialogProps). */
  version?: string | undefined;
  onClose: () => void;
}

/**
 * Render the settings dialog.
 * @param props - see SettingsPanelProps.
 * @returns the portaled overlay tree.
 */
export function SettingsPanel({ title, sections, version, onClose }: SettingsPanelProps): JSX.Element {
  const [activeId, setActiveId] = useState<string | undefined>(sections[0]?.id);
  // The leave guard. Switching a section away (and closing the panel) unmounts
  // the one on screen; when it holds unsaved edits the loss must be ASKED, not
  // taken — the same judgment the session-delete confirm makes for a row
  // button a reader may have mis-aimed. The section's own `dirty` is the only
  // voice: the panel cannot know what its fields mean.
  const [pendingLeave, setPendingLeave] = useState<LeaveIntent | null>(null);
  const active = sections.find((section) => section.id === activeId) ?? sections[0];
  const guard = (intent: LeaveIntent, proceed: () => void): void => {
    if (active?.dirty === true) setPendingLeave(intent);
    else proceed();
  };
  const handleSelect = (id: string): void => {
    // Re-picking the row already on screen is not a leave: it must not ask.
    if (id === activeId) return;
    guard({ kind: 'switch', id }, () => { setActiveId(id); });
  };
  const handleClose = (): void => { guard({ kind: 'close' }, onClose); };
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The modal layer's lifetime runs ONCE per mount: entry focus without a
  // ring, top-layer Escape and Tab ownership, and the focus return to the
  // invoker on unmount. The caller's onClose is read through the layer's own
  // ref, so a fresh callback per shell render does not re-bind anything.
  useModalLayer(panelRef, true, handleClose);

  return createPortal(
    <>
      <SettingsDialog
        title={title}
        sections={sections}
        activeId={activeId}
        onSelect={handleSelect}
        onClose={handleClose}
        version={version}
        panelRef={panelRef}
      />
      {pendingLeave !== null && (
        <UnsavedConfirmDialog
          section={active?.label ?? title}
          onConfirm={() => {
            const intent = pendingLeave;
            setPendingLeave(null);
            if (intent.kind === 'switch') setActiveId(intent.id);
            else onClose();
          }}
          onClose={() => { setPendingLeave(null); }}
        />
      )}
    </>,
    document.body,
  );
}
