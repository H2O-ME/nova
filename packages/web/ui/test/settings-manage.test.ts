/**
 * The settings panel's management state: the plugin manager's snapshot, the
 * Skill 中心's rows, the qqbot page, and the refusal signal that releases an
 * in-flight switch.
 *
 * The two things worth pinning here, both of which were broken:
 *
 *  - `skills.items` carries DISABLED skills too (the host sends discovery, not
 *    the filtered list) — a reducer that dropped them would re-break the
 *    one-way switch one layer down from where it was fixed;
 *  - a refused flip arrives as an `error` frame, NOT a fresh snapshot, so
 *    `manageError` must move on it. The sections watch that to release their
 *    in-flight row; without it a single refusal left every switch disabled.
 */
import { describe, expect, it } from 'vitest';
import { frameAction } from '../src/frame-actions.js';
import { initialState, reduce, type Action } from '../src/state.js';
import type { ServerFrame } from '../src/types.js';

/** Fold a list of frames through the real routing table and reducer. */
function fold(frames: readonly ServerFrame[]): ReturnType<typeof reduce> {
  return frames.reduce((state, frame) => {
    const action = frameAction(frame);
    // Every frame in these tests is one this surface acts on: a null here would
    // silently skip the assertion rather than fail it.
    if (action === null) throw new Error(`frame not routed: ${JSON.stringify(frame)}`);
    return reduce(state, action);
  }, initialState);
}

const ROSTER_ROW = { name: 'subagent', state: 'active', inject: [], enabled: true, origin: 'builtin' };

describe('plugins frame', () => {
  it('lands the roster and the disable list, and keeps the config path', () => {
    const state = fold([
      { type: 'roster', entries: [{ name: 'fs', state: 'active', inject: [] }], configPath: '/cfg.json' },
      { type: 'plugins', entries: [ROSTER_ROW], disable: ['subagent'] },
    ]);
    expect(state.plugins).toEqual({ entries: [ROSTER_ROW], disable: ['subagent'] });
    // The flip's answer restates the manager's rows but NOT the config path: it
    // must survive from the earlier `roster` frame rather than being dropped.
    expect(state.roster?.configPath).toBe('/cfg.json');
    expect(state.roster?.entries).toEqual([ROSTER_ROW]);
  });

  it('leaves a still-unknown config path alone rather than inventing one', () => {
    const state = fold([{ type: 'plugins', entries: [ROSTER_ROW], disable: [] }]);
    expect(state.roster).toBeNull();
  });
});

describe('skills frame', () => {
  it('keeps every discovered skill, including a switched-off one', () => {
    const state = fold([
      {
        type: 'skills',
        items: [
          { name: 'alpha', description: 'a', source: 'project', enabled: false },
          { name: 'beta', description: 'b', source: 'user', enabled: true },
        ],
        disable: ['alpha'],
      },
    ]);
    // The regression this pins: the host used to send the FILTERED list with
    // every row marked enabled, so a disabled skill was simply absent. Discovery
    // plus a disable list is what makes the switch reversible.
    expect(state.skills?.items.map((item) => item.name)).toEqual(['alpha', 'beta']);
    expect(state.skills?.items.find((item) => item.name === 'alpha')?.enabled).toBe(false);
    expect(state.skills?.disable).toEqual(['alpha']);
  });
});

describe('qqbot frames', () => {
  it('replaces the snapshot and clears a probe that belonged to older fields', () => {
    const state = fold([
      { type: 'qqbot', appId: '1', hasClientSecret: true },
      { type: 'qqbot_test', ok: false, message: 'bad' },
      // A save lands: the previous probe tested credentials that are no longer
      // the ones on screen.
      { type: 'qqbot', appId: '2', hasClientSecret: true },
    ]);
    expect(state.qqbot?.appId).toBe('2');
    expect(state.qqbotTest).toBeNull();
  });

  it('never carries a secret field through the wire type', () => {
    const state = fold([{ type: 'qqbot', appId: '1', hasClientSecret: true, clientSecretRef: 'QQ_SECRET' }]);
    expect(state.qqbot).toEqual({ appId: '1', hasClientSecret: true, clientSecretRef: 'QQ_SECRET' });
    // The snapshot is exactly what the page may show; a credential key must not
    // be able to ride along unnoticed.
    expect(Object.keys(state.qqbot ?? {})).not.toContain('clientSecret');
  });

  it('clears a probe on request', () => {
    // `qqbot_test_clear` is a LOCAL action (the page clears a stale result when
    // the operator edits a field), so it has no server frame — dispatch it
    // directly rather than routing it.
    const withTest = reduce(initialState, { type: 'qqbot_test', result: { ok: true, gateway: 'wss://gw' } });
    expect(withTest.qqbotTest?.ok).toBe(true);
    expect(reduce(withTest, { type: 'qqbot_test_clear' }).qqbotTest).toBeNull();
  });
});

describe('management refusals', () => {
  it('records an error frame as the last refusal', () => {
    const state = reduce(initialState, { type: 'error', message: '运行中不能切换插件开关' });
    // The sections watch this: a refusal is the WHOLE answer for a flip (no
    // snapshot follows), so without a signal here the row they disabled stays
    // disabled for the life of the panel.
    expect(state.manageError?.message).toBe('运行中不能切换插件开关');
  });

  it('advances the counter on a repeated refusal so the signal is observable', () => {
    const first = reduce(initialState, { type: 'error', message: 'same' });
    const second = reduce(first, { type: 'error', message: 'same' });
    // Same text, but a new value: an effect keyed on the object must re-run, or
    // the second refusal of one kind would leave the panel stuck.
    expect(second.manageError?.seq).toBeGreaterThan(first.manageError?.seq ?? 0);
  });

  it('starts with no refusal, and a re-baseline clears one', () => {
    expect(initialState.manageError).toBeNull();
    const failed = reduce(initialState, { type: 'error', message: 'nope' });
    const rebased = reduce(failed, {
      type: 'ready',
      info: {
        rootDir: '/w',
        sessionFile: '/s.jsonl',
        model: 'm',
        approvalMode: 'read-only',
        codeMode: 'native',
        modelSwitching: false,
        commands: [],
        history: [],
        historyTotal: 0,
        traceTotal: 0,
        pendingApprovals: [],
        pendingQuestions: [],
        jobs: [],
        usedTokens: 0,
        runTotals: {
          runs: 0,
          requests: 0,
          toolCalls: 0,
          retries: 0,
          llmMs: 0,
          toolMs: 0,
          firstTokenMs: 0,
          firstTokenRuns: 0,
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
        },
      },
    });
    // A reconnect is a fresh page: an old refusal must not keep a switch dark.
    expect(rebased.manageError).toBeNull();
  });

  it('does not mistake a refusal for a request settling', () => {
    // `error` settles the pagination flags too (its own long-standing rule); the
    // new field must be additive rather than a replacement for that.
    const sent = reduce(initialState, { type: 'sent', frame: { type: 'load_trace', have: 0 } });
    const failed = reduce(sent, { type: 'error', message: 'nope' });
    expect(failed.trace?.pending).toBe(false);
    expect(failed.manageError?.message).toBe('nope');
  });
});

describe('management actions keep the reducer exhaustive', () => {
  it('routes every new frame through the table', () => {
    const cases: readonly ServerFrame[] = [
      { type: 'plugins', entries: [], disable: [] },
      { type: 'skills', items: [], disable: [] },
      { type: 'qqbot' },
      { type: 'qqbot_test', ok: true, gateway: 'wss://gw' },
    ];
    for (const frame of cases) {
      const action: Action | null = frameAction(frame);
      expect(action, JSON.stringify(frame)).not.toBeNull();
    }
  });
});
