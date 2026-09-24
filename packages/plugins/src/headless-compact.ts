/**
 * Headless single-run auto-compact.
 *
 * exec-level runners have exactly ONE run for the whole task, so the boundary
 * gates (before the first request, after the turn) are useless: by the time
 * they could fire, the run is over. The gate therefore lives inside every
 * outgoing request, wrapping the composed hook chain once per assembly —
 * compacting IN PLACE (the message array is spliced, never replaced, so the run
 * keeps its alias) and reporting through the kernel notice channel, since this
 * path never goes through `AgentSession.compact()` and so emits no
 * `compaction` event.
 */
import {
  errMessage,
  wrapAutoCompact,
  type AgentHooks,
  type AgentMessage,
  type CompactedSession,
  type CompactSessionOptions,
} from '@nova-agent/core';

export interface HeadlessCompactOptions {
  limit: number;
  /** The compaction strategy to use (the `compaction` service). */
  compact: (options: CompactSessionOptions) => Promise<CompactedSession>;
  /** Where the summarizer request goes — same provider as the loop. */
  client: CompactSessionOptions['client'];
  /** The session the compaction is appended to, re-read per request. */
  target: () => { session: CompactSessionOptions['session']; notice(code: string, text: string): void } | undefined;
  notice: (code: 'compact_failed' | 'compact_fused' | 'compact_alias_broken', text: string) => void;
}

export function wrapHeadlessCompact(hooks: AgentHooks, options: HeadlessCompactOptions): void {
  wrapAutoCompact(hooks, {
    enabled: true,
    limit: options.limit,
    compact: async (messages: AgentMessage[]) => {
      const target = options.target();
      if (target === undefined) return;
      const outcome = await options.compact({
        client: options.client,
        session: target.session,
        messages,
        trigger: 'auto',
      });
      // In-place: runAgent and the session share this array.
      messages.splice(0, messages.length, ...outcome.surface);
      target.notice('compacted', `已自动压缩上下文 — 保留 ${outcome.retained} 条最近用户消息`);
    },
    onError: (err) => options.notice('compact_failed', `自动压缩失败（继续运行）：${errMessage(err)}`),
    onWarn: (code, text) => options.notice(code, text),
  });
}