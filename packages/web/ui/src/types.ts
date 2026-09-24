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
  AskResult,
  FileDiff,
  JobSnapshot,
  KernelEvent,
  ModelGroup,
  ModelOption,
  PtcMode,
  RunStats,
  SubagentProgress,
  SubagentUsage,
  ToolCallView,
  ToolResultView,
  TurnPhase,
} from '@nova-agent/core';
import type { ClientFrame, ReadyInfo, ServerFrame, SessionListItem, WireBlock, WireTraceRow } from '../../src/protocol';

/**
 * One row of the kernel's command catalog, derived from the frame that carries
 * it — the assembly's own shape (`Kernel.commands`), not a copy of it.
 */
export type CommandSummary = ReadyInfo['commands'][number];

export type {
  ApprovalMode,
  ApprovalRequest,
  AskResult,
  ClientFrame,
  FileDiff,
  JobSnapshot,
  KernelEvent,
  ModelGroup,
  ModelOption,
  PtcMode,
  ReadyInfo,
  RunStats,
  ServerFrame,
  SessionListItem,
  SubagentProgress,
  SubagentUsage,
  ToolCallView,
  ToolResultView,
  TurnPhase,
  WireBlock,
  WireTraceRow,
};