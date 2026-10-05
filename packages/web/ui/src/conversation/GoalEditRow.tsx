/**
 * The goal bar's inline edit form — split from `GoalPanel.tsx` because it owns
 * a different question (what the draft IS, and how it commits) from the strip's
 * job (what the goal currently reads as). Ported from the harness `ui-goal`
 * `GoalBar.tsx`'s editing arm (c) 2026 DeepSeek — MIT License: the same 26px
 * input in the same 36px strip, save/cancel on Enter/Escape, and an empty draft
 * disabling the save.
 */
import { useRef, useState } from 'react';
import { CheckIcon, CloseIcon } from '../icons.js';
import { Tooltip } from '../shell/Tooltip.js';
import { COMPOSING_GRACE_MS, composing } from '../composer-keys.js';
import css from './GoalPanel.module.css';

export interface GoalEditRowProps {
  /** The objective the form opens on. */
  objective: string;
  /** Commit the trimmed draft (never called with an empty one). */
  onSave: (objective: string) => void;
  onCancel: () => void;
}

export function GoalEditRow({ objective, onSave, onCancel }: GoalEditRowProps): JSX.Element {
  const [draft, setDraft] = useState(objective);
  // Composition watch, the composer's own predicate: an Enter that picks an IME
  // candidate (or Safari's late keydown just after `compositionend`) is the
  // IME's, not a save — typing a Chinese objective used to commit the half-
  // composed pinyin as the goal on the very Enter that confirmed it.
  const composingUntilRef = useRef(0);
  const save = (): void => {
    const trimmed = draft.trim();
    if (trimmed === '') return;
    onSave(trimmed);
  };
  return (
    <>
      <input
        className={css.objectiveInput}
        type="text"
        aria-label="目标内容"
        value={draft}
        onChange={(event) => { setDraft(event.target.value); }}
        onCompositionStart={() => { composingUntilRef.current = 0; }}
        onCompositionEnd={() => { composingUntilRef.current = Date.now() + COMPOSING_GRACE_MS; }}
        onKeyDown={(event) => {
          if (composing({
            key: event.key,
            shiftKey: event.shiftKey,
            repeat: event.repeat,
            keyCode: event.keyCode,
            isComposing: event.nativeEvent.isComposing,
            recentlyComposing: Date.now() < composingUntilRef.current,
          })) return;
          if (event.key === 'Enter') save();
          if (event.key === 'Escape') onCancel();
        }}
        autoFocus
      />
      <div className={css.actions}>
        <Tooltip label="保存目标" side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.iconBtn}
            onClick={save}
            disabled={draft.trim() === ''}
            aria-label="保存目标"
          >
            <CheckIcon />
          </button>
        </Tooltip>
        <Tooltip label="取消编辑" side="bottom" delayMs={500}>
          <button
            type="button"
            className={css.iconBtn}
            onClick={onCancel}
            aria-label="取消编辑"
          >
            <CloseIcon />
          </button>
        </Tooltip>
      </div>
    </>
  );
}
