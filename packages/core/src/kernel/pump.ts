/**
 * One producer, N consumers, in-order. The kernel's `AgentSession` publishes
 * `KernelEvent`s here; surfaces subscribe (callback) or iterate (`events()`).
 * Publishing inside the run loop never blocks on a consumer: callback
 * listeners run inline (a throwing listener is re-thrown async so it is loud
 * but cannot kill the pump), and async consumers get their own queue — a
 * stalled past-cap consumer drops its window with a `surface_lagged` notice
 * instead of backpressuring the agent.
 */
import type { KernelEvent, NoticeCode } from './protocol.js';

/** Async-consumer queue cap: beyond it the consumer's window is stale anyway. */
const MAX_LAG = 2000;

export class EventPump {
  private readonly consumers = new Set<AsyncConsumer>();
  private readonly listeners = new Set<(event: KernelEvent) => void>();
  private closed = false;

  publish(event: KernelEvent): void {
    if (this.closed) return;
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(event);
      } catch (err) {
        queueMicrotask(() => {
          throw err;
        });
      }
    }
    for (const consumer of Array.from(this.consumers)) {
      if (consumer.queue.length >= MAX_LAG) {
        consumer.queue.length = 0;
        const code: NoticeCode = 'surface_lagged';
        consumer.queue.push({ type: 'notice', code, text: 'consumer lagged; event window reset' });
      } else {
        consumer.queue.push(event);
      }
      const wake = consumer.notify;
      consumer.notify = undefined;
      wake?.();
    }
  }

  /** Live subscriber for in-process projections (no queueing semantics). */
  subscribe(listener: (event: KernelEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Async iteration view; completes when the pump closes and drains. */
  async *events(): AsyncGenerator<KernelEvent> {
    const consumer: AsyncConsumer = { queue: [] };
    this.consumers.add(consumer);
    try {
      for (;;) {
        while (consumer.queue.length > 0) {
          yield consumer.queue.shift() as KernelEvent;
        }
        if (this.closed) return;
        await new Promise<void>((resolve) => {
          consumer.notify = resolve;
        });
      }
    } finally {
      this.consumers.delete(consumer);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const consumer of this.consumers) {
      const wake = consumer.notify;
      consumer.notify = undefined;
      wake?.();
    }
  }
}

interface AsyncConsumer {
  queue: KernelEvent[];
  notify?: () => void;
}
