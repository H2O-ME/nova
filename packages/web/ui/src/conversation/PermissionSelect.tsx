/**
 * The composer's two mode selectors, ported from deepseek-harness
 * `ui-permission-presets` PermissionSelect.tsx + PermissionSelect.module.css
 * (c) 2026 DeepSeek — MIT License: a 28px chip trigger (glyph + label +
 * chevron) opening the shared `shell/Menu.tsx` card — a trailing check on the
 * row in force, and the reference's whole interaction contract (focus stays on
 * the trigger, the arrow keys walk, Escape closes and hands the keyboard
 * back) owned once by the primitive.
 *
 * Two product differences, both deliberate:
 *  - the tier vocabulary is ours (`read-only` / `auto-edit` / `full` and
 *    `native` / `ptc` / `both`, owned by `mode-options.ts`), mapped onto the
 *    source's three badge glyphs (check / workspace pencil / exclamation);
 *  - the source's `danger-full-access` acknowledge dialog is not ported — the
 *    pick applies straight away, as this product's mode controls always have.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Menu } from '../shell/Menu.js';
import { APPROVAL_MODES, CODE_MODES } from './mode-options.js';
import { ChevronDownIcon } from '../icons.js';
import type { ApprovalMode, PtcMode } from '../types.js';
import css from './PermissionSelect.module.css';

/* Shield contour and the glyphs drawn over it (design set 1556 over the
   ui-primitives shield): check = read-only, pencil = workspace write,
   exclamation = full access. currentColor so the trigger and menu rows tint
   them with their own text color. */

const SHIELD_OUTLINE_PATH =
  'M8.20554 0.899994L14.7901 3.36857V7.01026C14.7901 12 11.0466 14.2103 8.20554 15.3C5.36446 14.2103 1.62012 12 1.62012 7.01026V3.36857L8.20554 0.899994Z';
const SHIELD_OUTLINE_STROKE = '1.31831';

const permissionGlyphs = new Map<string, ReactNode>([
  [
    'read-only',
    <svg key="read-only" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={SHIELD_OUTLINE_PATH} stroke="currentColor" strokeWidth={SHIELD_OUTLINE_STROKE} strokeLinejoin="round" />
      <path d="M12.1654 5.7552L8.9447 9.41475C8.73044 9.65816 8.53628 9.8804 8.35774 10.0423C8.1713 10.2114 7.94235 10.3717 7.64016 10.4254C7.48207 10.4535 7.32 10.4552 7.16151 10.4294C6.85843 10.3801 6.62728 10.2223 6.43836 10.0559C6.25752 9.89653 6.06037 9.67732 5.84264 9.43705L4.72925 8.20897L5.63557 7.38707L6.74897 8.61594C6.98603 8.87755 7.12974 9.03533 7.24673 9.13839C7.31033 9.19443 7.34485 9.21476 7.35823 9.22122C7.38068 9.22484 7.40352 9.22515 7.42593 9.22122C7.40522 9.22502 7.42893 9.23294 7.53583 9.136C7.65132 9.03126 7.79316 8.87139 8.02643 8.60638L11.2479 4.94763L12.1654 5.7552Z" fill="currentColor" />
    </svg>,
  ],
  [
    'auto-edit',
    <svg key="auto-edit" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8.08887 0.251709C8.20479 0.23085 8.32486 0.241168 8.43652 0.282959L15.0215 2.75171C15.2787 2.84819 15.4492 3.09414 15.4492 3.3689V7.0105C15.4492 7.10986 15.4441 7.2081 15.4414 7.30542C15.0285 7.07175 14.5905 6.87695 14.1309 6.73022V3.82495L8.20508 1.60327L2.2793 3.82495V7.0105C2.27936 9.7171 3.4745 11.5379 5.02734 12.7947C5.01025 12.9942 5 13.1962 5 13.4001C5.00001 13.7617 5.02722 14.1169 5.08008 14.4636C2.91555 13.0393 0.961014 10.752 0.960938 7.0105V3.3689C0.960938 3.09417 1.13146 2.84821 1.38867 2.75171L7.97461 0.282959L8.08887 0.251709Z" fill="currentColor" />
      <path d="M11.3525 5.64688V6.85688H5V5.64688H11.3525Z" fill="currentColor" />
      <path d="M9.5824 8.29376V9.50376H5V8.29376H9.5824Z" fill="currentColor" />
      <path d="M14.6647 15.6852H10.0338C10.3878 15.3751 10.7567 15.0517 11.0772 14.7706C11.2531 14.6164 11.4144 14.4746 11.5511 14.3547H14.6647V15.6852Z" fill="currentColor" />
      <path d="M8.14852 14.1308L7.33925 15.4976C7.22458 15.6912 7.42245 15.9194 7.63037 15.8333L9.09785 15.2254L15.0399 10.0719L14.0905 8.97733L8.14852 14.1308Z" fill="currentColor" />
    </svg>,
  ],
  [
    'full',
    <svg key="full" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d={SHIELD_OUTLINE_PATH} stroke="currentColor" strokeWidth={SHIELD_OUTLINE_STROKE} strokeLinejoin="round" />
      <path d="M9.10094 4.5V8.75939H7.59888V4.5H9.10094Z" fill="currentColor" />
      <path d="M9.10094 9.8114V11.5H7.59888V9.8114H9.10094Z" fill="currentColor" />
    </svg>,
  ],
]);

/** One selectable mode of a menu: the wire value plus the copy it reads as. */
interface ModeOption<T extends string> {
  code: T;
  label: string;
  hint: string;
}

interface ModeSelectProps<T extends string> {
  /** The mode in force (the host's echo is the truth, never a local pick). */
  value: T;
  options: readonly ModeOption<T>[];
  /** What the accessible name calls the choice ("access mode", "run mode"). */
  name: string;
  onPick: (code: T) => void;
  /** Preferred side of the trigger (flips when that side cannot fit). */
  side?: 'below' | 'above';
  /** Which trigger edge the card aligns to (the settings rows align end). */
  align?: 'start' | 'end';
  /** Leading row glyph; triggers without one keep their label at every width. */
  glyphOf?: (code: string) => ReactNode;
  /** The kernel holds no session (or an ask is pending): the trigger refuses. */
  disabled?: boolean;
}

/** The chip trigger and its card, shared by both selectors. The card is the
 *  shell's Menu primitive: portaled beside the page and placed from the
 *  trigger rect, flipping to whichever side fits — at the composer's foot that
 *  is always upward; in the settings panel the rows sit high enough to open
 *  downward. A pick lands only when it differs from the echo. */
function ModeSelect<T extends string>({
  value,
  options,
  name,
  onPick,
  side = 'below',
  align = 'start',
  glyphOf,
  disabled = false,
}: ModeSelectProps<T>): JSX.Element {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.code === value);
  const currentLabel = current?.label ?? value;
  const glyph = glyphOf?.(value);
  return (
    <Menu
      open={open}
      label={name}
      side={side}
      align={align}
      items={options.map((option) => ({
        id: option.code,
        label: option.label,
        icon: glyphOf?.(option.code),
        title: option.hint,
      }))}
      selectedId={value}
      onSelect={(id) => {
        const picked = options.find((option) => option.code === id);
        if (picked === undefined) return;
        setOpen(false);
        if (picked.code !== value) onPick(picked.code);
      }}
      onClose={() => { setOpen(false); }}
      listClassName={css.modeList}
      anchor={
        <button
          type="button"
          className={css.trigger}
          aria-label={`${name}，当前：${currentLabel}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          title={current?.hint}
          onClick={() => { setOpen(!open); }}
        >
          {glyph !== undefined && (
            <span className={css.triggerIcon} aria-hidden>
              {glyph}
            </span>
          )}
          <span className={css.triggerLabel}>{currentLabel}</span>
          <span className={open ? `${css.chevron} ${css.chevronOpen}` : css.chevron} aria-hidden>
            <ChevronDownIcon />
          </span>
        </button>
      }
    />
  );
}

export interface PermissionSelectProps {
  /** The approval tier in force. */
  value: ApprovalMode;
  /** The pick lands as the `set_approval_mode` frame. */
  onPick: (mode: ApprovalMode) => void;
  /** Preferred side of the trigger (the settings rows open upward). */
  side?: 'below' | 'above';
  /** Which trigger edge the card aligns to (the settings rows align end). */
  align?: 'start' | 'end';
  disabled?: boolean;
}

/** Access-tier selector (read-only / auto-edit / full). */
export function PermissionSelect({ value, onPick, side, align, disabled }: PermissionSelectProps): JSX.Element {
  return (
    <ModeSelect
      value={value}
      options={APPROVAL_MODES}
      name="访问模式"
      onPick={onPick}
      glyphOf={(code) => permissionGlyphs.get(code)}
      side={side}
      align={align}
      disabled={disabled}
    />
  );
}

export interface CodeModeSelectProps {
  /** The execution mode in force. */
  value: PtcMode;
  /** The pick lands as the `set_code_mode` frame. */
  onPick: (mode: PtcMode) => void;
  /** Preferred side of the trigger (the settings rows open upward). */
  side?: 'below' | 'above';
  /** Which trigger edge the card aligns to (the settings rows align end). */
  align?: 'start' | 'end';
  disabled?: boolean;
}

/** Execution-mode selector (native / ptc / both): no glyph, so its label stays
 *  visible at every width (the trigger recipe only collapses glyph-carrying
 *  triggers). */
export function CodeModeSelect({ value, onPick, side, align, disabled }: CodeModeSelectProps): JSX.Element {
  return (
    <ModeSelect
      value={value}
      options={CODE_MODES}
      name="执行模式"
      onPick={onPick}
      side={side}
      align={align}
      disabled={disabled}
    />
  );
}
