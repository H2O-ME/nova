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
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  ContextBreakdown,
  ContextCategory,
  ContextElement,
  ContextEventRecord,
  ContextPoint,
  ContextTimeline,
  FileDiff,
  FileOpRecord,
  Goal,
  GoalStatus,
  JobSnapshot,
  KernelEvent,
  ModelGroup,
  ModelOption,
  PtcMode,
  QuestionRequest,
  RunStats,
  SubagentProgress,
  SubagentUsage,
  TodoItem,
  ToolCallView,
  ToolResultView,
  TurnPhase,
} from '@nova-agent/core';
import type { ClientFrame, ConfiguredModel, ModelCapabilities, ReadyInfo, ServerFrame, SessionListItem, WireBlock, WireDirectoryLevel, WireFileEntry, WireProviderRow, WireRosterEntry, WireSkillEntry, WireTraceRow } from '../../src/protocol';

/**
 * One row of the kernel's command catalog, derived from the frame that carries
 * it — the assembly's own shape (`Kernel.commands`), not a copy of it.
 */
export type CommandSummary = ReadyInfo['commands'][number];

export type {
  ApprovalMode,
  ApprovalRequest,
  AskResult,
  AskUserQuestionAnswer,
  AskUserQuestionItem,
  ContextBreakdown,
  ContextCategory,
  ContextElement,
  ContextEventRecord,
  ContextPoint,
  ContextTimeline,
  Goal,
  GoalStatus,
  ClientFrame,
  ConfiguredModel,
  FileDiff,
  FileOpRecord,
  JobSnapshot,
  KernelEvent,
  ModelCapabilities,
  ModelGroup,
  ModelOption,
  PtcMode,
  QuestionRequest,
  ReadyInfo,
  RunStats,
  ServerFrame,
  SessionListItem,
  SubagentProgress,
  SubagentUsage,
  TodoItem,
  ToolCallView,
  ToolResultView,
  TurnPhase,
  WireBlock,
  WireDirectoryLevel,
  WireFileEntry,
  WireProviderRow,
  WireRosterEntry,
  WireSkillEntry,
  WireTraceRow,
};