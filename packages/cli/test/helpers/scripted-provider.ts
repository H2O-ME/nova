/**
 * Shared scripted-provider fixture for the cli test suite (M9.7 阶段 J dedup).
 * Mirrors the core test helper of the same name; kept duplicated (not
 * re-exported from core's helpers) because core/test is not a package
 * export, and a cross-package test-helper import would be a first in this
 * repo. The body is identical so the two suites drift in lockstep if ever
 * touched.
 */
import type { ChatProvider, ChatRequest, StreamEvent } from '@nova-agent/core';

export function scriptedProvider(scripts: StreamEvent[][], capture?: ChatRequest[]): ChatProvider {
  let call = 0;
  return {
    async *stream(req: ChatRequest) {
      capture?.push(req);
      const events = scripts[call] ?? [];
      call += 1;
      for (const ev of events) yield ev;
    },
  };
}
