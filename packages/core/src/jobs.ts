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
}

export interface JobOutcome {
  status: 'completed' | 'killed' | 'failed';
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
}

interface JobEntry extends JobSnapshot {
  outputLimitBytes?: number;
  cancel: (reason?: string) => void;
  readOutput?(): string;
  done: Promise<JobOutcome>;
}

const DEFAULT_JOB_OUTPUT_LIMIT = 256 * 1024;

export class JobRegistry {
  private readonly jobs = new Map<string, JobEntry>();
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
      ...(start.outputLimitBytes !== undefined ? { outputLimitBytes: start.outputLimitBytes } : {}),
      cancel: start.cancel,
      ...(start.readOutput !== undefined ? { readOutput: start.readOutput } : {}),
      done: start.done,
    };
    this.jobs.set(id, entry);
    void start.done
      .then((outcome) => {
        if (entry.status === 'stopping') entry.status = 'killed';
        else entry.status = outcome.status;
        if (outcome.detail !== undefined) entry.detail = outcome.detail;
      })
      .catch((err: unknown) => {
        // A rejecting done promise is a producer bug (contract: never reject);
        // record failure instead of leaving the job stuck as running.
        entry.status = 'failed';
        entry.detail = err instanceof Error ? err.message : String(err);
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
    ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
  };
}
