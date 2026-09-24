/**
 * The paged windows over a session's durable log (M11 批6; generalized when the
 * 轨迹 view arrived): a projection held server-side so `ready` can ship only its
 * tail.
 *
 * Why freeze it: the browser pages backwards with a cursor measured against
 * what it already holds, so the array those indices point into must not move.
 * Live events append to the log — and to the client's live area — but never to
 * this snapshot; a session switch (or a reconnect) recomputes it, which is
 * exactly when the client's cursor is reset too.
 *
 * One class serves both windows (the transcript baseline and the trace): the
 * cursor arithmetic and the "an empty batch is an answer, not an error" rule are
 * one rule, and a second copy of it would be a second chance to disagree.
 *
 * Projecting the whole log on every `ready` is deliberate: the cost is one pass
 * over data the controller already holds, and an incremental projection would
 * have to mirror the log's compaction rewrites to stay correct.
 */
export class LogWindow<T> {
  private items: T[] = [];

  /**
   * @param page - rows one page carries (both the tail and the batch size).
   */
  constructor(private readonly page: number) {}

  /** Re-project the log and return the tail a `ready` frame should carry. */
  refresh(items: readonly T[]): { tail: T[]; total: number } {
    this.items = [...items];
    return { tail: this.items.slice(-this.page), total: this.items.length };
  }

  get total(): number {
    return this.items.length;
  }

  /**
   * The batch immediately older than the `have` newest rows. A client that
   * already holds everything (or asks past the start) gets an empty batch
   * rather than an error: "no more history" is an answer, not a failure.
   */
  earlierThan(have: number): T[] {
    const end = Math.max(0, this.items.length - have);
    return this.items.slice(Math.max(0, end - this.page), end);
  }
}