/**
 * Minimal background-job runtime (dsh jobs seam, reduced to one in-process
 * registry for a single session). Producers own execution resources; the
 * registry owns identity, lifecycle state and output cursors. The `subagent`
 * kind is reserved now so future delegation work reuses the same owner /
 * cancel / notification contract (dsh's JobKindMap pattern).
 */
export type JobKind = 'bash' | 'subagent';

export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed';

export interface JobSnapshot {
  id: string;
  kind: JobKind;
  /** One-line model-facing label (the command, the delegation description). */
  label: string;
  status: JobStatus;
  /** Producer-specific detail rendered into status lines ('exit code: 3'). */
  detail?: string;
  /** Wall-clock start (ms epoch); UIs derive elapsed time from it. */
  startedAt?: number;
  /** Latest activity line sampled from the producer (UI live rows). */
  progress?: string;
}

export interface JobOutcome {
  status: 'completed' | 'killed' | 'failed';
  detail?: string;
}

/**
 * A job that reached a natural terminal state and has not yet been announced.
 * `killed` is deliberately absent: that outcome only ever follows an explicit
 * `stop()`/dispose (the model already knows, or the session is over), so there
 * is nothing to announce. Consumers drain these and inject them into the next
 * LLM request, replacing the need for the model to poll `jobs output`.
 */
export interface JobNotice {
  id: string;
  kind: JobKind;
  label: string;
  status: 'completed' | 'failed';
  detail?: string;
}

export interface JobStart {
  kind: JobKind;
  label: string;
  /** Hard cap on the bytes retained in the output ring per job. */
  outputLimitBytes?: number;
  /** Request termination. Must be synchronous and idempotent. */
  cancel(reason?: string): void;
  /**
   * Resolves after the producer releases its resources (not merely when work
   * finishes); the registry converts the settled outcome into final status.
   */
  done: Promise<JobOutcome>;
  /** Consume output produced since the previous call; absence marks a final-output-only job. */
  readOutput?(): string;
  /**
   * One-line latest-activity sample for UI live rows, read FRESH on every
   * snapshot (list/get). Unlike readOutput this is a peek: it never drains
   * the model-facing output cursor.
   */
  progress?(): string | undefined;
}

interface JobEntry extends Omit<JobSnapshot, 'progress'> {
  outputLimitBytes?: number;
  cancel: (reason?: string) => void;
  readOutput?(): string;
  /** Accessor form on the entry; snapshots carry the sampled string. */
  progress?(): string | undefined;
  done: Promise<JobOutcome>;
}

const DEFAULT_JOB_OUTPUT_LIMIT = 256 * 1024;

export class JobRegistry {
  private readonly jobs = new Map<string, JobEntry>();
  /** Terminal jobs (completed/failed) awaiting announcement; drainFinished consumes. */
  private readonly pendingNotices: JobNotice[] = [];
  private counter = 0;

  /** Register a started job; returns its model-facing snapshot. */
  start(start: JobStart): JobSnapshot {
    this.counter += 1;
    const id = `${start.kind}-${this.counter}`;
    const entry: JobEntry = {
      id,
      kind: start.kind,
      label: start.label,
      status: 'running',
      startedAt: Date.now(),
      ...(start.outputLimitBytes !== undefined ? { outputLimitBytes: start.outputLimitBytes } : {}),
      cancel: start.cancel,
      ...(start.readOutput !== undefined ? { readOutput: start.readOutput } : {}),
      ...(start.progress !== undefined ? { progress: start.progress } : {}),
      done: start.done,
    };
    this.jobs.set(id, entry);
    void start.done
      .then((outcome) => {
        // Natural completion/failure is announced once; a stop-initiated kill
        // (entry was 'stopping') is not — the caller already knows it stopped.
        if (entry.status !== 'stopping') {
          entry.status = outcome.status;
          if (outcome.status !== 'killed') {
            this.pendingNotices.push({
              id,
              kind: entry.kind,
              label: entry.label,
              status: outcome.status,
              ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
            });
          }
        } else {
          entry.status = 'killed';
        }
        if (outcome.detail !== undefined) entry.detail = outcome.detail;
      })
      .catch((err: unknown) => {
        // A rejecting done promise is a producer bug (contract: never reject);
        // record failure instead of leaving the job stuck as running.
        entry.status = 'failed';
        entry.detail = err instanceof Error ? err.message : String(err);
        this.pendingNotices.push({
          id,
          kind: entry.kind,
          label: entry.label,
          status: 'failed',
          detail: entry.detail,
        });
      });
    return snapshotOf(entry);
  }

  list(): JobSnapshot[] {
    return [...this.jobs.values()].map(snapshotOf);
  }

  get(id: string): JobSnapshot | undefined {
    const entry = this.jobs.get(id);
    return entry === undefined ? undefined : snapshotOf(entry);
  }

  /**
   * Consume and clear the terminal-job notices queued since the last call.
   * One drain = one announcement per job, UNLESS the carrying request dies
   * before the model acknowledges it (the runner requeues, making delivery
   * at-least-once). The runner calls this right before each LLM request and
   * injects the result.
   */
  drainFinished(): JobNotice[] {
    if (this.pendingNotices.length === 0) return [];
    const drained = this.pendingNotices.splice(0);
    return drained;
  }

  /**
   * Put notices back at the queue head when the request that carried them
   * failed or was aborted before its assistant reply was committed — the
   * model never got to act on them, so "drain-once" would silence the
   * announcement forever. A requeued batch announces at-least-once; a rare
   * duplicate costs one idle line, a lost one costs a stalled task.
   */
  requeue(notices: JobNotice[]): void {
    if (notices.length === 0) return;
    this.pendingNotices.unshift(...notices);
  }

  /** Consume output produced since the previous call, with a per-read cap. */
  readOutput(id: string, maxBytes = DEFAULT_JOB_OUTPUT_LIMIT): string | undefined {
    const entry = this.jobs.get(id);
    if (entry?.readOutput === undefined) return undefined;
    const text = entry.readOutput();
    const encoder = new TextEncoder();
    if (encoder.encode(text).length <= maxBytes) return text;
    // Tail-keep like the loop's truncation: recent output matters most.
    const bytes = encoder.encode(text);
    let startIdx = bytes.length - maxBytes;
    while (startIdx < bytes.length && (bytes[startIdx]! & 0xc0) === 0x80) startIdx += 1;
    return `…[earlier output dropped]\n${new TextDecoder().decode(bytes.subarray(startIdx))}`;
  }

  /** Request termination and wait for the producer to release its resources. */
  async stop(id: string, reason?: string): Promise<JobSnapshot | undefined> {
    const entry = this.jobs.get(id);
    if (entry === undefined) return undefined;
    if (entry.status === 'running') {
      entry.status = 'stopping';
      entry.cancel(reason);
    }
    return snapshotOf(entry);
  }

  /** Cancel everything and wait for all producers to settle (session teardown). */
  async dispose(): Promise<void> {
    for (const entry of this.jobs.values()) {
      if (entry.status === 'running') {
        entry.status = 'stopping';
        entry.cancel('session ended');
      }
    }
    await Promise.allSettled([...this.jobs.values()].map((entry) => entry.done));
  }
}

function snapshotOf(entry: JobEntry): JobSnapshot {
  return {
    id: entry.id,
    kind: entry.kind,
    label: entry.label,
    status: entry.status,
    startedAt: entry.startedAt,
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    ...(entry.progress !== undefined ? { progress: entry.progress() } : {}),
  };
}

/** Cap for a job label inside a notice: the raw command can be very long. */
const JOB_NOTICE_LABEL_MAX = 80;

/**
 * One model-facing body per drain: a line per finished job in the same shape
 * as the `jobs` tool's list rows (`- bash-1 [completed] sleep 10 (exit code:
 * 0)`), so the injected notice reads like tool output the model already knows.
 * Output itself stays behind the `jobs output` cursor — the notice only says
 * a job is done, keeping the context lean.
 */
export function formatJobNotices(notices: JobNotice[]): string {
  const body = notices
    .map((n) => {
      const label = n.label.length > JOB_NOTICE_LABEL_MAX ? `${n.label.slice(0, JOB_NOTICE_LABEL_MAX - 1)}…` : n.label;
      const detail = n.detail !== undefined ? ` (${n.detail})` : '';
      return `- ${n.id} [${n.status}] ${label}${detail}`;
    })
    .join('\n');
  return [
    `Background job${notices.length === 1 ? '' : 's'} finished:`,
    body,
    'Read the output with the jobs tool (action=output, id=<id>) as needed.',
  ].join('\n');
}
