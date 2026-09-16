import { newId, type AgentEvent, type AgentMessage, type Session, type Usage, type UsageStats, type UserMessage } from '@nova-agent/core';
import { statusLine, type Palette, type StopKind } from '@nova-agent/tui-view';
import { LONG_TASK, maxTurnsHint } from './runner-shared.js';
import type { Config } from './config.js';

/**
 * 四 runner（tui / repl / exec / qqbot）共享的「事件消费簿记」单源。
 *
 * AGENTS.md 的启动装配统一（createSessionRuntime / agentRunBase）只覆盖了
 * 请求侧；消费侧的会话日志追加、usage/锚点簿记、中断归类与完成/出错 toast
 * 曾是每 runner 一份（持久化 switch ×4、锚点归零四连 ×6、toast ×3），每次
 * 修 bug 要同步改四处。本模块把它们收为单源；呈现与投影专属分支（TUI 投影、
 * exec JSONL 行、qqbot 回复捕获）留在各 shell 自己的事件 switch 里。
 */

/** 交互 runner 的 pre-flight 压缩锚点态（exec/qqbot 无 pre-flight，不持有）。 */
export interface UsageAnchorState {
  lastUsage: Usage | undefined;
  lastPromptTokens: number;
  usageAnchor: Usage | undefined;
  anchorMsgCount: number;
}

export function createUsageAnchors(): UsageAnchorState {
  return { lastUsage: undefined, lastPromptTokens: 0, usageAnchor: undefined, anchorMsgCount: 0 };
}

/**
 * 四连归零单源：/new、会话切换、压缩成功后都要回到「无锚点」基线——保留旧
 * 锚点会让 fresh session 的缓存键指向旧会话，或触发一次伪压缩。
 */
export function resetUsageAnchors(a: UsageAnchorState): void {
  a.lastUsage = undefined;
  a.lastPromptTokens = 0;
  a.usageAnchor = undefined;
  a.anchorMsgCount = 0;
}

export interface RunnerBookkeeping {
  /**
   * 单源「事件 → 会话日志 + usage 簿记」：message / tool_call_result /
   * turn_aborted 追加日志（"model-visible means logged"）；usage 累计 stats，
   * 持有锚点态时按护栏收锚点。其余事件类型无操作（返回 false）。
   */
  apply(event: AgentEvent): Promise<boolean>;
}

export function createRunnerBookkeeping(deps: {
  /** 追加目标；访问器 —— /new 与会话切换会重绑 session。 */
  session: () => Session;
  stats: UsageStats;
  /** 交互 runner 的锚点态；无头 runner 省略（usage 只累计 stats）。 */
  anchors?: UsageAnchorState;
  /** 锚点收取基准：usage 到达时的消息面长度（访问器，重绑理由同 session）。 */
  messages?: () => readonly AgentMessage[];
}): RunnerBookkeeping {
  return {
    async apply(event: AgentEvent): Promise<boolean> {
      switch (event.type) {
        case 'message':
          await deps.session().append(event.message);
          return true;
        case 'tool_call_result':
          await deps.session().append(event.result);
          return true;
        case 'turn_aborted':
          await deps.session().append(event.message);
          return true;
        case 'usage': {
          Object.assign(deps.stats, event.stats);
          const a = deps.anchors;
          if (a !== undefined) {
            a.lastUsage = event.usage;
            a.lastPromptTokens = event.usage.promptTokens;
            // prompt_tokens 缺失（client coerce 成 0）的 usage 块不收为锚点，
            // 否则仪表中途塌成 0 直到下一次真实上报。
            if (event.usage.promptTokens > 0) {
              a.usageAnchor = event.usage;
              a.anchorMsgCount = deps.messages?.().length ?? 0;
            }
          }
          return true;
        }
        default:
          return false;
      }
    },
  };
}

/**
 * 中断归类：以本轮 signal 是否真的触发为准，绝不匹配错误文案——undici 与
 * 部分网关在网络停摆时抛 "The operation was aborted due to timeout"，按文案
 * 归类会把真实错误（与重试线索）藏进一句静默的「已中断」。
 */
export function isUserInterrupt(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

export interface TurnNotifier {
  /** 长轮完成提示（阈值见 LONG_TASK；短轮静默——那就是刷屏）。 */
  done(startedAt: number): void;
  /** 长轮出错提示（errorMs 阈值）。 */
  error(startedAt: number, message: string): void;
}

/**
 * 完成/出错 toast 单源：tui/repl/exec 各写一份的「任务已完成/任务出错」文案
 * 与 LONG_TASK 阈值判断收拢于此。`enabled` 供 TUI 的退出中静默（exiting）。
 */
export function createTurnNotifier(
  notify: (title: string, body: string) => void,
  opts?: { enabled?: () => boolean; /** 无头 exec 用更长的完成阈值。 */ doneMs?: number },
): TurnNotifier {
  const enabled = opts?.enabled ?? ((): boolean => true);
  const doneMs = opts?.doneMs ?? LONG_TASK.doneMs;
  return {
    done(startedAt: number): void {
      if (!enabled()) return;
      const elapsed = Date.now() - startedAt;
      if (elapsed >= doneMs) {
        notify('任务已完成', `本轮耗时约 ${Math.max(1, Math.round(elapsed / 60000))} 分钟，回到终端查看结果`);
      }
    },
    error(startedAt: number, message: string): void {
      if (!enabled()) return;
      if (Date.now() - startedAt >= LONG_TASK.errorMs) {
        notify('任务出错', message.slice(0, 120));
      }
    },
  };
}

/**
 * Commit a user turn to both surfaces in the one order that keeps them equal:
 * push into the live array THEN append to the log (the projection contract the
 * runners share — "model-visible means logged"). Every runner used to spell
 * this trio out inline.
 */
export async function commitUserMessage(
  session: Session,
  messages: AgentMessage[],
  content: string,
): Promise<UserMessage> {
  const userMsg: UserMessage = { id: newId('msg'), ts: Date.now(), role: 'user', content };
  messages.push(userMsg);
  await session.append(userMsg);
  return userMsg;
}

/**
 * Provider dropped the response mid-stream and is re-requesting. The body is
 * shared (callers add their own leading spaces / ⟳ marker / gutter); the wording
 * is a contract, not styling.
 */
export function llmRetryNotice(error: string, attempt: number, maxRetries: number): string {
  return `上游流中断（${error}），自动重试 ${attempt}/${maxRetries}…`;
}

/** The model "finished" with no text and no tool calls (thinking-only output). */
export function emptyCompletionNotice(finishReason: string, attempt: number, maxRetries: number): string {
  return `空回复（finish=${finishReason}，输出疑似全部进入思考流），自动重试 ${attempt}/${maxRetries}…`;
}

/**
 * End-of-turn lines shared by the interactive runners: the status one-liner
 * (only for an abnormal stop — a normal reply ends at the reply) plus the
 * max-turns escape hatch. `complete` yields no line because the answer itself
 * is the confirmation.
 */
export function turnStopLines(
  paint: Palette,
  kind: StopKind,
  stats: UsageStats,
  elapsedMs: number,
  config: Config,
): string[] {
  const lines = [statusLine(paint, kind, stats, elapsedMs)];
  if (kind === 'max_turns') lines.push(paint.dim(maxTurnsHint(config)));
  return lines;
}
