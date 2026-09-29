/**
 * The live status rows (`flow/StatusRows.tsx`): one background job, one nested
 * subagent. Both are "one row per entity, rewritten in place" rows, so what is
 * pinned here is the CONTRACT with the harness they are ported from rather than
 * the exact wording:
 *
 *  - the job row's state dot follows `ui-jobs/JobListAction.tsx` — `stopping`
 *    and `killed` share the attention color because both mean the work ended on
 *    request, not on its own;
 *  - the subagent row carries the harness catalog row's information: the label,
 *    the activity clause, the total tokens and the active duration. The entry
 *    `mode` and the last-turn-completed fact come from a session projection this
 *    kernel has no producer for, so their absence is asserted rather than their
 *    wording.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { JobRow, SubagentRow } from '../src/flow/StatusRows.js';
import type { JobSnapshot } from '../src/types.js';
import type { SubRow } from '../src/state.js';

const job = (over: Partial<JobSnapshot> = {}): JobSnapshot => ({
  id: 'bash-1',
  kind: 'bash',
  label: 'pnpm build',
  status: 'running',
  sessionId: 'sess_test',
  ...over,
});

const sub = (over: Partial<SubRow> = {}): SubRow => ({
  label: 'scout',
  status: 'running',
  calls: 3,
  ...over,
});

const renderJob = (over: Partial<JobSnapshot> = {}): string =>
  renderToStaticMarkup(<JobRow job={job(over)} onStop={() => {}} />);

const renderSub = (over: Partial<SubRow> = {}): string =>
  renderToStaticMarkup(<SubagentRow sub={sub(over)} />);

/**
 * The `data-state` written on the StateDot itself. The row element carries its
 * own `data-state` (the raw status), so the dot's mark — which maps several
 * statuses onto one visual family — is read off the mark element by its own CSS
 * class prefix: `dot`/`step` for the solid family, `spinner` for ongoing.
 */
const DOT_TAG_RE = /<[a-z]+ class="_((?:dot|step|spinner))_[0-9a-f]+"[^>]*?data-state="([a-z]+)"/u;
function dotState(html: string): string | undefined {
  return DOT_TAG_RE.exec(html)?.[2];
}

describe('job row', () => {
  it('marks a running job ongoing and its settled outcomes done and error', () => {
    expect(dotState(renderJob())).toBe('ongoing');
    expect(dotState(renderJob({ status: 'completed' }))).toBe('done');
    expect(dotState(renderJob({ status: 'failed' }))).toBe('error');
  });

  it('gives stopping and killed the same attention mark, as the harness does', () => {
    // Both mean "ended (or ending) on request", so neither is a silent idle dot
    // and neither is an error: `ui-jobs/JobListAction.tsx` maps both to warning.
    expect(dotState(renderJob({ status: 'stopping' }))).toBe('warning');
    expect(dotState(renderJob({ status: 'killed' }))).toBe('warning');
  });

  it('offers the stop control only while the job can still be stopped', () => {
    expect(renderJob()).toContain('>停止<');
    // A stopping job keeps the control visible but inert (the press is in
    // flight), so the row does not appear to accept a second one.
    expect(renderJob({ status: 'stopping' })).toContain('disabled=""');
    expect(renderJob({ status: 'completed' })).not.toContain('>停止<');
  });
});

describe('subagent row', () => {
  it('draws the label separate from its activity clause', () => {
    const html = renderSub({ detail: 'read_file {"path":"a.ts"}' });
    // The label is its own element; the clause is the sibling summary.
    expect(html).toContain('>scout</span>');
    const summary = /class="_summary_[0-9a-f]+">([^<]*)</u.exec(html)?.[1];
    expect(summary).toContain('read_file');
    expect(summary).toContain('正在运行');
  });

  it('reports the child\'s own active duration and total tokens once it has usage', () => {
    const html = renderSub({
      status: 'completed',
      usage: { elapsedMs: 21_400, turns: 2, toolCalls: 3, promptTokens: 12_000, completionTokens: 800 },
    });
    expect(html).toContain('21.4s');
    // Total tokens are the child's own consumption, prompt + completion.
    expect(html).toContain('12.8K tok');
  });

  it('omits the metrics group while the child has reported no usage', () => {
    expect(renderSub()).not.toContain('tok');
  });

  it('falls back to the call count as the clause\'s lead fact', () => {
    const html = renderSub({ status: 'completed', calls: 4 });
    const summary = /class="_summary_[0-9a-f]+">([^<]*)</u.exec(html)?.[1];
    expect(summary).toBe('4 次调用 · 已完成');
  });

  it('keeps the state dot on the nested loop\'s own terminal status', () => {
    expect(dotState(renderSub())).toBe('ongoing');
    expect(dotState(renderSub({ status: 'completed' }))).toBe('done');
    expect(dotState(renderSub({ status: 'aborted' }))).toBe('idle');
    expect(dotState(renderSub({ status: 'ended' }))).toBe('idle');
  });

  it('never renders an inherited Object member as a status word', () => {
    // The regression this pins: both rows looked their label up as
    // `TABLE[status]`, and the status arrives on a `job_update` /
    // `subagent_update` frame. A status naming an `Object.prototype` member
    // therefore resolved to the inherited FUNCTION rather than undefined — the
    // `??` fallback that would have caught it never fires — and the row printed
    // that function's source text into the transcript. Proven by rendering:
    // `SubagentRow` used to emit `function Object() { [native code] }`.
    for (const status of ['constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
      const subHtml = renderSub({ status: status as never });
      expect(subHtml, `subagent ${status}`).not.toContain('function');
      expect(subHtml, `subagent ${status}`).not.toContain('[native code]');
      const jobHtml = renderToStaticMarkup(
        <JobRow job={job({ status: status as never })} onStop={() => undefined} />,
      );
      expect(jobHtml, `job ${status}`).not.toContain('function');
      expect(jobHtml, `job ${status}`).not.toContain('[native code]');
    }
    // A status this build does not know still renders a row, with the neutral
    // in-progress word rather than a blank or a crash.
    expect(renderSub({ status: 'not_a_real_status' as never })).toContain('当前未运行');
  });
});
