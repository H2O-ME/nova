/**
 * Goal mode as the reader sees it: the composer's `/goal` ghost hint and the
 * goal panel — two surfaces of ONE value, both rebuilt from `ready` when a
 * session is switched or the process is restarted (the log-only `goal/change`
 * is the durable record, and `ready.goal` is its replay).
 *
 * Static markup only (this lane has no DOM). The assertions are about what a
 * reader sees and about the state it is derived from — never about class names.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Goal } from '@nova-agent/core';
import type { ReadyInfo } from '../../src/protocol.js';
import { emptyTotals } from '../../src/totals.js';
import { initialState, reduce } from '../src/state.js';
import { GOAL_ACTIVE_HINT, GOAL_HINT, claimHint } from '../src/composer/claim-hint.js';
import { DraftSurface } from '../src/composer/DraftSurface.js';
import { GoalPanel } from '../src/conversation/GoalPanel.js';

const GOAL: Goal = {
  id: 'goal_1',
  objective: '发布 v1',
  status: 'active',
  rounds: 2,
  maxRounds: 10,
  createdAt: 1,
  updatedAt: 2,
};

/** The kernel catalog the composer filters and claims against. */
const CATALOG = [
  { name: 'goal', description: '设定或查看长期目标' },
  { name: 'compact', description: '压缩上下文' },
];

function readyInfo(goal: Goal | null): ReadyInfo {
  return {
    rootDir: 'D:/proj',
    sessionFile: 'D:/proj/s.jsonl',
    model: 'test-model',
    approvalMode: 'read-only',
    codeMode: 'native',
    history: [],
    historyTotal: 0,
    traceTotal: 0,
    pendingApprovals: [],
    pendingQuestions: [],
    jobs: [],
    usedTokens: 0,
    modelSwitching: false,
    commands: CATALOG,
    runTotals: emptyTotals,
    goal,
  };
}

describe('claimHint', () => {
  it('hints a blank /goal, and switches copy once a goal is in force', () => {
    // The disambiguation is the whole point: the same claim means two different
    // things, and the reference keys them `hint.goal` / `hint.goal.active`.
    expect(claimHint('/goal', CATALOG, false)).toBe(GOAL_HINT);
    // The token carries a trailing space the moment a pick writes it; a hint
    // that vanished on that space would never be seen in practice.
    expect(claimHint('/goal ', CATALOG, false)).toBe(GOAL_HINT);
    expect(claimHint('/goal', CATALOG, true)).toBe(GOAL_ACTIVE_HINT);
    expect(GOAL_ACTIVE_HINT).not.toBe(GOAL_HINT);
  });

  it('says nothing once the objective is being typed, or when it has no copy', () => {
    expect(claimHint('/goal 发布 v1', CATALOG, false)).toBeNull();
    // A command with no dictionary entry draws no line — this is not a place to
    // invent copy per command.
    expect(claimHint('/compact ', CATALOG, false)).toBeNull();
    // A name the registry does not claim is delivered as an ordinary prompt, so
    // hinting it would promise something that never happens.
    expect(claimHint('/goa', CATALOG, false)).toBeNull();
    expect(claimHint('看看 /goal 的用法', CATALOG, false)).toBeNull();
  });
});

interface SurfaceProps {
  value: string;
  hint: string | null;
  composing?: boolean;
}

function drawSurface({ value, hint, composing = false }: SurfaceProps): string {
  return renderToStaticMarkup(createElement(DraftSurface, {
    value,
    disabled: false,
    placeholder: '发消息',
    hint,
    composing,
    boxRef: { current: null },
    scrollRef: { current: null },
    onChange: () => {},
    onCaret: () => {},
    onKeyDown: () => {},
    onCompositionStart: () => {},
    onCompositionEnd: () => {},
  }));
}

describe('DraftSurface hint', () => {
  it('draws the hint after the draft, inside one hidden line', () => {
    const html = drawSurface({ value: '/goal ', hint: GOAL_HINT });
    // The line's element, from its opening bracket: the attributes a reader's
    // assistive tech reads (and the ones this test reads) sit in front of the
    // marker attribute.
    const at = html.indexOf('data-composer-hint');
    const line = html.slice(html.lastIndexOf('<', at));
    // Structural, not cosmetic: the draft must come first, or the hint would be
    // painted on top of the text the reader is typing.
    expect(line.indexOf('/goal')).toBeGreaterThan(-1);
    expect(line.indexOf(GOAL_HINT)).toBeGreaterThan(line.indexOf('/goal'));
    expect(line).toContain('aria-hidden="true"');
  });

  it('draws nothing without a hint, and hides it under a composition', () => {
    expect(drawSurface({ value: '/goal ', hint: null })).not.toContain('data-composer-hint');
    expect(drawSurface({ value: '/goal ', hint: GOAL_HINT, composing: true })).not.toContain(GOAL_HINT);
  });
});

describe('replay: one value drives both surfaces', () => {
  it('restores the panel AND the active hint from ready.goal', () => {
    const state = reduce(initialState, { type: 'ready', info: readyInfo(GOAL) });
    expect(state.goal).toEqual(GOAL);
    expect(renderToStaticMarkup(createElement(GoalPanel, { goal: state.goal }))).toContain('发布 v1');
    // The line a reload used to lose: with the goal back, the composer no longer
    // invites an objective the command would refuse.
    expect(claimHint('/goal', CATALOG, state.goal !== null)).toBe(GOAL_ACTIVE_HINT);
  });

  it('a switch to a goal-less session clears both', () => {
    const withGoal = reduce(initialState, { type: 'ready', info: readyInfo(GOAL) });
    const switched = reduce(withGoal, { type: 'ready', info: readyInfo(null) });
    expect(switched.goal).toBeNull();
    expect(renderToStaticMarkup(createElement(GoalPanel, { goal: switched.goal }))).toBe('');
    expect(claimHint('/goal', CATALOG, switched.goal !== null)).toBe(GOAL_HINT);
  });

  it('a live goal event moves the same two surfaces, and a clear closes them', () => {
    const set = reduce(initialState, { type: 'event', event: { type: 'goal', goal: GOAL } });
    expect(renderToStaticMarkup(createElement(GoalPanel, { goal: set.goal }))).toContain('发布 v1');
    const cleared = reduce(set, { type: 'event', event: { type: 'goal', goal: null } });
    expect(cleared.goal).toBeNull();
    expect(renderToStaticMarkup(createElement(GoalPanel, { goal: cleared.goal }))).toBe('');
    expect(claimHint('/goal', CATALOG, cleared.goal !== null)).toBe(GOAL_HINT);
  });
});
