/**
 * The 工作步骤展示 settings row — port of the harness `ui-chat`'s
 * `settings/TranscriptViewRow.tsx` + `PreferenceRow.tsx` (c) 2026 DeepSeek —
 * MIT License: the title and description on the left, a menu selector on the
 * right whose four modes (简洁 / 标准 / 详细 / 完全展开) map onto the
 * presentation policy the transcript reads. The trigger recipe is the shared
 * {@link ModeSelect} card, aligned to the row's end like the other settings
 * controls.
 */
import { ModeSelect } from '../conversation/PermissionSelect.js';
import type { ModeOption } from '../conversation/PermissionSelect.js';
import type { TranscriptViewMode } from '../chat/transcript-view.js';
import { SETTINGS_COPY } from './copy.js';
import { SettingsRow } from './SettingsRow.js';

/** The four modes' copy and what each does to the transcript. */
const MODE_OPTIONS: readonly ModeOption<TranscriptViewMode>[] = [
  { code: 'compact', label: SETTINGS_COPY['transcript.compact'], hint: '已完成的回合只显示概况行' },
  { code: 'standard', label: SETTINGS_COPY['transcript.standard'], hint: '过程折叠为概况，运行中显示当前动作' },
  { code: 'detailed', label: SETTINGS_COPY['transcript.detailed'], hint: '运行中的回合平铺步骤，历史回合折叠' },
  { code: 'verbose', label: SETTINGS_COPY['transcript.verbose'], hint: '所有步骤全部展开显示' },
];

export interface TranscriptViewRowProps {
  /** The persisted work-details mode in force. */
  mode: TranscriptViewMode;
  /** Switch the work-details presentation. */
  onPick: (mode: TranscriptViewMode) => void;
}

/**
 * Render the work-details mode selector.
 * @param props - see TranscriptViewRowProps.
 * @returns the settings row.
 */
export function TranscriptViewRow({ mode, onPick }: TranscriptViewRowProps): JSX.Element {
  return (
    <SettingsRow title={SETTINGS_COPY['transcript.title']} description={SETTINGS_COPY['transcript.description']}>
      <ModeSelect
        value={mode}
        options={MODE_OPTIONS}
        name="工作步骤展示"
        onPick={onPick}
        side="above"
        align="end"
      />
    </SettingsRow>
  );
}
