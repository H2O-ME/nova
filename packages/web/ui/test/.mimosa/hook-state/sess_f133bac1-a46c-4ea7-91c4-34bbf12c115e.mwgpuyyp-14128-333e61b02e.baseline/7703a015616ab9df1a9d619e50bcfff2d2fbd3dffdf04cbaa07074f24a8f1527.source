/**
 * The 工作步骤展示 vocabulary (`transcript-view.ts`): the four modes map to
 * one policy each (the harness's `presentation-policy.ts` table), an unknown
 * or missing stored value reads as standard, and the persisted preference
 * round-trips through storage.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TRANSCRIPT_VIEW_MODE,
  TRANSCRIPT_VIEW_MODES,
  parseTranscriptView,
  presentationPolicyFor,
  readTranscriptView,
  writeTranscriptView,
} from '../src/chat/transcript-view.js';

/** A localStorage stand-in over a Map (the test lane is node, no jsdom). */
function stubStorage(entries: Record<string, string> = {}, throws = false): Map<string, string> {
  const store = new Map(Object.entries(entries));
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => {
      if (throws) throw new Error('SecurityError');
      return store.get(k) ?? null;
    },
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('policies', () => {
  it('maps each mode to its exact policy row', () => {
    expect(presentationPolicyFor('compact')).toEqual({
      mode: 'compact', foldCompletedTurns: true, stepGrouping: 'collapsed', liveProcessDetail: false, settledReasoningPreview: false,
    });
    expect(presentationPolicyFor('standard')).toEqual({
      mode: 'standard', foldCompletedTurns: true, stepGrouping: 'collapsed', liveProcessDetail: true, settledReasoningPreview: true,
    });
    expect(presentationPolicyFor('detailed')).toEqual({
      mode: 'detailed', foldCompletedTurns: true, stepGrouping: 'history', liveProcessDetail: true, settledReasoningPreview: true,
    });
    expect(presentationPolicyFor('verbose')).toEqual({
      mode: 'verbose', foldCompletedTurns: false, stepGrouping: 'none', liveProcessDetail: false, settledReasoningPreview: true,
    });
  });

  it('defaults to standard and names the four modes', () => {
    expect(DEFAULT_TRANSCRIPT_VIEW_MODE).toBe('standard');
    expect(TRANSCRIPT_VIEW_MODES).toEqual(['compact', 'standard', 'detailed', 'verbose']);
  });
});

describe('parse and persistence', () => {
  it('reads missing, malformed and unknown values as standard', () => {
    expect(parseTranscriptView(null)).toBe('standard');
    expect(parseTranscriptView('')).toBe('standard');
    expect(parseTranscriptView('standard')).toBe('standard');
    expect(parseTranscriptView('cozy')).toBe('standard');
  });

  it('round-trips the chosen mode through storage', () => {
    stubStorage();
    expect(readTranscriptView()).toBe('standard');
    writeTranscriptView('verbose');
    expect(readTranscriptView()).toBe('verbose');
    writeTranscriptView('detailed');
    expect(readTranscriptView()).toBe('detailed');
  });

  it('survives private mode: the default wins when storage refuses', () => {
    stubStorage({}, true);
    expect(readTranscriptView()).toBe('standard');
    expect(() => writeTranscriptView('verbose')).not.toThrow();
  });
});
