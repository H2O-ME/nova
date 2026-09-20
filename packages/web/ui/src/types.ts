/**
 * Shared types for the browser side — every shape is imported from its owner
 * (kernel protocol types live in @nova-agent/core; wire frames and the
 * transcript projection in the web package's protocol source), never
 * restated. Type-only: esbuild erases these imports, so the ui bundle ships no
 * server code.
 */
import type {
  ApprovalMode,
  ApprovalRequest,
  FileDiff,
  JobSnapshot,
  KernelEvent,
  PtcMode,
  RunStats,
  ToolCallView,
  ToolResultView,
  TurnPhase,
} from '@nova-agent/core';
import type { ClientFrame, ReadyInfo, ServerFrame, SessionListItem, WireBlock } from '../../src/protocol';

export type {
  ApprovalMode,
  ApprovalRequest,
  ClientFrame,
  FileDiff,
  JobSnapshot,
  KernelEvent,
  PtcMode,
  ReadyInfo,
  RunStats,
  ServerFrame,
  SessionListItem,
  ToolCallView,
  ToolResultView,
  TurnPhase,
  WireBlock,
};