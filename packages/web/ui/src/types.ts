/**
 * Shared types for the browser side — every shape is imported from its
 * owner (kernel protocol types live in @nova-agent/core; the wire frames in
 * the web package's protocol source), never restated. Type-only: esbuild
 * erases the import, the ui bundle ships no server code.
 */
import type { ApprovalRequest, KernelEvent, TurnPhase } from '@nova-agent/core';
import type { ClientFrame, ReadyInfo, ServerFrame, SessionListItem } from '../../src/protocol';

export type { ApprovalRequest, ClientFrame, KernelEvent, ReadyInfo, ServerFrame, SessionListItem, TurnPhase };
