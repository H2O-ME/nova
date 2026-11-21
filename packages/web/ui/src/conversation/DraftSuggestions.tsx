/**
 * The hero's suggestion chips — the reference's `ConversationDraftSuggestedPrompts`
 * in its `chips` layout (ZCode 2026-11-15: 「我们也应该学习」).
 *
 * What is copied from the reference, value by value:
 *  - the strip is a HORIZONTAL scroller with its scrollbar hidden, not a
 *    wrapping row (`overflow-x-auto [scrollbar-width:none]`), and its group is
 *    `w-max` + centred (`mx-auto flex items-center gap-4`);
 *  - a chip is the reference's outline Button at `size=lg`: `h-8` (32),
 *    `rounded-lg` (8), `px-3`, `gap-1.5`, border `--border` (10%),
 *    `text-ui-base` (14) at NORMAL weight;
 *  - the icon and the label both rest at `opacity: .7` and step to 1 on hover;
 *  - the entrance is the reference's waterfall: 260ms settle-out, each chip
 *    delayed `index * 65ms`, from `translateY(-12px)` with a `clip-path` wipe.
 *
 * What is NOT copied: the catalog. The reference's items (and their prompts)
 * come from a remote "client scenes" service and some carry plugin/automation
 * actions; Nova has no such service and no automations surface, so these four
 * templates are LOCAL constants and every chip writes its prompt into the
 * composer draft (the reference's `replacePlainPrompt` path — it never sends).
 */
import type { CSSProperties } from 'react';
import { BookIcon, ChecklistIcon, FileIcon, MoonIcon } from '../icons.js';
import css from './DraftSuggestions.module.css';

/** One suggestion: what the chip says and the prompt it stages. */
interface DraftSuggestion {
  id: string;
  label: string;
  /** The draft this chip writes. Trailing colon = the reader fills the rest. */
  prompt: string;
  icon: JSX.Element;
}

/** The four chips (office-first: 资料整理 replaces the reference's 报错修复 slot). */
const DRAFT_SUGGESTIONS: readonly DraftSuggestion[] = [
  {
    id: 'weekly',
    label: '周报总结',
    prompt: '帮我总结本周的工作进展，生成一份周报草稿：',
    icon: <ChecklistIcon />,
  },
  {
    id: 'organize',
    label: '资料整理',
    prompt: '帮我整理这些资料，提取要点并生成一份清单：',
    icon: <BookIcon />,
  },
  {
    id: 'slides',
    label: 'PPT 制作',
    prompt: '帮我把下面这个主题做成一份 PPT 大纲与每页内容：',
    icon: <FileIcon />,
  },
  {
    id: 'offpeak',
    label: '闲时任务',
    prompt: '帮我整理一份可以放到闲时执行的任务清单：',
    icon: <MoonIcon />,
  },
];

export interface DraftSuggestionsProps {
  /** A chip was picked: stage its prompt in the composer draft. */
  onPick: (prompt: string) => void;
  /** No socket, or an approval is pending: the chips refuse like the composer. */
  disabled?: boolean;
}

/**
 * Render the hero's suggestion strip.
 * @param props - see DraftSuggestionsProps.
 * @returns the chip strip.
 */
export function DraftSuggestions({ onPick, disabled = false }: DraftSuggestionsProps): JSX.Element {
  return (
    <div className={css.root}>
      <div className={css.group}>
        {DRAFT_SUGGESTIONS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={css.chip}
            /* The waterfall's per-chip delay rides one custom property: the
               animation itself is the shared keyframe. */
            style={{ '--nova-chip-delay': `${index * 65}ms` } as CSSProperties}
            disabled={disabled}
            onClick={() => { onPick(item.prompt); }}
          >
            <span className={css.icon} aria-hidden="true">{item.icon}</span>
            <span className={css.label}>{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
