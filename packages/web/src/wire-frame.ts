/**
 * Outbound frame enrichment: attach render intent to the two tool events.
 *
 * Resolved here, from the LIVE registry (`host.tools` is re-read every event — a
 * workspace switch or a PTC rebuild swaps the host), so no surface re-derives
 * per-tool knowledge and every client renders the same call the same way. Split
 * from the controller because it is the one part of emitting that is a pure
 * function of the event plus the kernel's current tool table.
 */
import { callViewOf, resultViewOf, type KernelEvent } from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import type { ServerFrame } from './protocol.js';

/**
 * Wrap one kernel event in the frame that carries it, adding the tool views the
 * browser side must not have to derive.
 * @param kernel - the live kernel, for its current tool table.
 * @param event - the kernel event being broadcast.
 * @returns the frame to serialize.
 */
export function wireFrame(kernel: Kernel, event: KernelEvent): ServerFrame {
  if (event.type === 'tool_call_start') {
    return { type: 'event', event, view: callViewOf(kernel.host.tools, event.call) };
  }
  if (event.type === 'tool_call_result') {
    return {
      type: 'event',
      event,
      resultView: resultViewOf(kernel.host.tools, event.call, event.result.content),
    };
  }
  return { type: 'event', event };
}
