/**
 * The work-details preference — port of the harness `ui-chat`'s
 * `chat-settings.ts` (mode vocabulary) + `presentation-policy.ts` (runtime
 * table), (c) 2026 DeepSeek — MIT License. A reader picks how much tool-call
 * detail the transcript shows (设置 · 工作步骤展示), and renderers select
 * single fields of the derived policy; none of them compares the mode enum,
 * so adding a mode changes only the table below.
 *
 * Persistence rides localStorage like the theme preference does: this is a
 * viewer preference over the LOCAL transcript, not session state — the host
 * has no frame for it and the reducer never sees it.
 */
import { useCallback, useMemo, useState } from 'react';

/** Work-details presentation modes a user can choose. */
export const TRANSCRIPT_VIEW_MODES = ['compact', 'standard', 'detailed', 'verbose'] as const;
export type TranscriptViewMode = (typeof TRANSCRIPT_VIEW_MODES)[number];

/** Standard process summaries for readers without an explicit preference. */
export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'standard';

const STORAGE_KEY = 'nova.transcriptView';

/**
 * Presentation capabilities that one work-details mode enables. `mode` rides
 * along for diagnostics only — renderers branch on the capability fields.
 */
export interface ChatPresentationPolicy {
  readonly mode: TranscriptViewMode;
  /** Whether a normally completed turn folds its process rows behind the turn header. */
  readonly foldCompletedTurns: boolean;
  /** Collapsible group headers for all turns, historical turns only, or no turns. */
  readonly stepGrouping: 'collapsed' | 'history' | 'none';
  /** Show the running command, path, query, or reasoning detail in group titles. */
  readonly liveProcessDetail: boolean;
  /** Whether a settled reasoning row previews its first line beside the title. */
  readonly settledReasoningPreview: boolean;
}

const POLICIES: Readonly<Record<TranscriptViewMode, ChatPresentationPolicy>> = {
  compact: {
    mode: 'compact',
    foldCompletedTurns: true,
    stepGrouping: 'collapsed',
    liveProcessDetail: false,
    settledReasoningPreview: false,
  },
  standard: {
    mode: 'standard',
    foldCompletedTurns: true,
    stepGrouping: 'collapsed',
    liveProcessDetail: true,
    settledReasoningPreview: true,
  },
  detailed: {
    mode: 'detailed',
    foldCompletedTurns: true,
    stepGrouping: 'history',
    liveProcessDetail: true,
    settledReasoningPreview: true,
  },
  verbose: {
    mode: 'verbose',
    foldCompletedTurns: false,
    stepGrouping: 'none',
    liveProcessDetail: false,
    settledReasoningPreview: true,
  },
};

/**
 * Resolve the policy constant for one mode. The same mode always yields the
 * same object, so selectors over a policy see stable identities.
 */
export function presentationPolicyFor(mode: TranscriptViewMode): ChatPresentationPolicy {
  return POLICIES[mode];
}

/** Parse a stored value; missing and unrecognized modes both read as standard. */
export function parseTranscriptView(raw: string | null): TranscriptViewMode {
  return (TRANSCRIPT_VIEW_MODES as readonly string[]).includes(raw ?? '')
    ? (raw as TranscriptViewMode)
    : DEFAULT_TRANSCRIPT_VIEW_MODE;
}

/** Read the persisted preference (private mode falls through to the default). */
export function readTranscriptView(): TranscriptViewMode {
  try {
    return parseTranscriptView(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_TRANSCRIPT_VIEW_MODE;
  }
}

/** Persist the preference; a failed write simply does not survive the reload. */
export function writeTranscriptView(mode: TranscriptViewMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* private mode: the choice simply does not survive the reload */
  }
}

/**
 * The work-details preference + its policy as view state: the mode is the
 * persisted half, the policy the derived half (same mode, same object). One
 * hook so the settings row and the transcript can never read two values.
 */
export function useTranscriptView(): {
  mode: TranscriptViewMode;
  policy: ChatPresentationPolicy;
  setMode: (mode: TranscriptViewMode) => void;
} {
  const [mode, setModeState] = useState(readTranscriptView);
  const setMode = useCallback((next: TranscriptViewMode): void => {
    writeTranscriptView(next);
    setModeState(next);
  }, []);
  const policy = useMemo(() => presentationPolicyFor(mode), [mode]);
  return { mode, policy, setMode };
}
