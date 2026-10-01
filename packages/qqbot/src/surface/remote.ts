/**
 * 遥控：把一条认得的指令**真的接到内核上**（`remote-parse.ts` 只负责认字）。
 *
 * 每一件事都复用既有接缝，这里不新造第二套系统：
 *  - **权限档** → `AgentSession.setApprovalMode()`
 *  - **审批** → 不自动拒绝：把请求发到 QQ、等对端回 `/approve` / `/deny`，走
 *    `pendingApprovals()` / `resolveApproval()`。超时**必定拒绝**（fail-closed）。
 *  - **换模型** → `Kernel.models.select()`（它内部就是 `ChatProvider.setModel()` +
 *    `announceModel()`，与设置页同一个门）
 *  - **工作区** → `Kernel.setWorkspace()`（校验与拒绝都归内核，这里只把结果翻成人话）
 *  - **会话** → `Kernel.newAgentSession()`，由调用方 `activateSession` 并换掉绑定
 *
 * 全部依赖注入，所以每一条都能对着假实现直接驱动，不需要网络也不需要真内核。
 */
import { errMessage } from '@nova-agent/core';
import type { AgentSession, ApprovalMode, AskResult } from '@nova-agent/core';
import type { RemoteCommand, RemotePerm } from './remote-parse.js';

/**
 * The kernel capabilities remote control needs — exactly the ones in the module
 * header and nothing else.
 *
 * Narrow on purpose: a missing capability should be a type error here, not a
 * silent refusal at runtime. `models` keeps the SAME optionality as the kernel's
 * own seat (`Kernel.models`): it is absent when the assembly had no
 * `modelCatalog` or the provider cannot retarget, and a remote `/model` must then
 * say so rather than pretend the switch landed.
 */
export interface RemoteKernelPort {
  /** Validates and refuses inside the kernel; the rejection propagates. */
  setWorkspace(dir: string): Promise<unknown>;
  rootDir(): string;
  /** The model seat, when this kernel has one (see `Kernel.models`). */
  models?: {
    current(): string;
    list(): Promise<readonly { models: readonly { id: string }[] }[]>;
    select(model: string): Promise<{ id: string }>;
  };
}

/**
 * The per-peer session handle remote control needs.
 *
 * Separate from `RemoteKernelPort` because these are facts about THIS peer's
 * conversation (its tier, its outstanding ask), while the port is about the
 * shared kernel. The bridge owns the session per peer, so it supplies both.
 */
export interface RemoteSessionPort {
  setApprovalMode(mode: ApprovalMode): void;
  /** The tier actually in force — the read-back that proves the write landed. */
  approvalMode(): ApprovalMode | undefined;
  pendingApprovals(): readonly { id: string; call: { name: string } }[];
  resolveApproval(id: string, answer: AskResult): boolean;
}

/** How long a remote approval waits before it fails closed. */
export const REMOTE_APPROVAL_TIMEOUT_MS = 3 * 60_000;

/** 权限档 → 中文读数（与设置页 / REPL 同一套词汇）。 */
const PERM_LABEL: Readonly<Record<RemotePerm, string>> = {
  'read-only': '只读',
  'auto-edit': '自动编辑',
  full: '全放行',
};

/** `/help` 的清单：词汇表本身就是说明书。 */
export const REMOTE_HELP = [
  '可用遥控指令：',
  '/status — 看当前工作区 / 模型 / 权限 / 待审批',
  '/perm read-only|auto-edit|full — 切换权限档',
  '/model — 列出可选模型；/model <id> — 切换',
  '/ws — 看当前工作区；/ws <目录> — 切换',
  '/new — 为这个对话开一个新会话',
  '/approve — 允许待审批的命令；/deny — 拒绝',
  '/help — 这份清单',
  '（不认得的 / 开头行、以及所有其它文本，都原样作为提示词发给 agent。）',
].join('\n');

/**
 * Wait for a remote approval answer.
 *
 * **The timeout is the point.** A QQ peer may simply not answer (they walked
 * away, the phone died, the group scrolled past), and an ask that waits forever
 * parks the whole run. So the wait has an explicit bound and fails closed to a
 * denial — the same discipline the kernel uses when a socket drops with an ask
 * outstanding.
 *
 * Exported so a caller holding a promise-shaped ask gets the SAME bound instead
 * of inventing a second one. It is not what `PeerTurns` uses, and the difference
 * is the protocol, not an oversight: a peer answers by sending a LATER MESSAGE,
 * so the parked wait lives at the ask (`PeerTurns.forwardApproval`'s timer),
 * where there is no promise to race. Both read `REMOTE_APPROVAL_TIMEOUT_MS`.
 * @param ask - sends the question and resolves with one reply line.
 * @param timeoutMs - the bound; defaults to the shared constant.
 * @returns the reply line, or undefined on timeout (the caller then denies).
 */
export async function awaitRemoteAnswer(
  ask: (question: string) => Promise<string>,
  timeoutMs: number = REMOTE_APPROVAL_TIMEOUT_MS,
): Promise<string | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  try {
    return await Promise.race([
      ask('有待审批的命令，请回复 /approve 允许或 /deny 拒绝（超时将自动拒绝）。'),
      expired,
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 执行一条指令所需的全部接缝。 */
export interface RemoteContext {
  kernel: RemoteKernelPort;
  session: RemoteSessionPort;
  /** 为这个对端开一个新会话（`/new`）；调用方据此换绑自己那份对端表。 */
  newSession: () => Promise<AgentSession>;
}

/** 一句话回复 +（`/new` 时）要换绑的新会话句柄。 */
export interface RemoteOutcome {
  reply: string;
  /** Present for `/new`: the caller rebinds this peer to it. */
  nextAgent?: AgentSession;
}

/** `/status` 的读数。 */
function statusText(ctx: RemoteContext): string {
  const mode = ctx.session.approvalMode();
  const label = mode === undefined ? '未知' : (PERM_LABEL[mode] ?? mode);
  const pending = ctx.session.pendingApprovals().length;
  const model = ctx.kernel.models?.current() ?? '未知（本进程没有模型座位）';
  return [
    `工作区：${ctx.kernel.rootDir()}`,
    `模型：${model}`,
    `权限：${label}`,
    pending > 0 ? `待审批：${pending} 条（回复 /approve 或 /deny）` : '无待审批',
  ].join('\n');
}

/**
 * Execute one parsed command.
 *
 * Every branch ANSWERs — a remote command that silently did nothing is
 * indistinguishable from a broken channel, and the peer has no other way to tell.
 * @param command - the parsed command.
 * @param ctx - the kernel and session seams.
 * @returns the text to send back, plus the new session for `/new`.
 */
export async function runRemoteCommand(command: RemoteCommand, ctx: RemoteContext): Promise<RemoteOutcome> {
  switch (command.kind) {
    case 'help':
      return { reply: REMOTE_HELP };
    case 'status':
      return { reply: statusText(ctx) };
    case 'perm': {
      ctx.session.setApprovalMode(command.mode);
      // Read back rather than echoing: `setApprovalMode` no-ops when a session
      // has no permission service, and claiming a switch that did not land is
      // worse than admitting it.
      const now = ctx.session.approvalMode();
      if (now !== command.mode) return { reply: `权限未能切换（当前：${now ?? '未知'}）。` };
      return { reply: `权限已切到「${PERM_LABEL[command.mode]}」。` };
    }
    case 'model': {
      const seat = ctx.kernel.models;
      if (seat === undefined) return { reply: '这个进程没有模型座位（端点未配置或不可切换），换模型请在设置页操作。' };
      const option = await seat.select(command.model);
      return { reply: `模型已切到 ${option.id}。` };
    }
    case 'models': {
      const seat = ctx.kernel.models;
      if (seat === undefined) return { reply: '这个进程没有模型座位（端点未配置或不可切换）。' };
      const groups = await seat.list();
      const ids = groups.flatMap((group) => group.models.map((model) => model.id));
      if (ids.length === 0) return { reply: '端点没有公布任何模型；可以在设置页里手动配置 models[]。' };
      return { reply: `可选模型：\n${ids.map((id) => `- ${id}`).join('\n')}\n用 /model <id> 切换。` };
    }
    case 'workspace': {
      try {
        await ctx.kernel.setWorkspace(command.dir ?? '');
      } catch (err) {
        // The kernel owns validation (missing / not a directory / inside
        // `~/.nova`); this only phrases its refusal for a chat window.
        return { reply: `工作区未切换：${errMessage(err)}` };
      }
      return { reply: `工作区已切到 ${ctx.kernel.rootDir()}。` };
    }
    case 'new': {
      // Created through the injected seam, so the peer→session map stays in ONE
      // place (the bridge's) instead of a second copy here.
      const nextAgent = await ctx.newSession();
      return { reply: '已为这个对话开一个新会话，后面的消息走新会话。', nextAgent };
    }
    case 'approve': {
      const first = ctx.session.pendingApprovals()[0];
      if (first === undefined) return { reply: '现在没有待审批的命令。' };
      // A denial carries the reason the model will read, so the remote path states
      // one instead of sending a bare `deny`: the tool result becomes an
      // instruction ("the operator declined"), not an unexplained refusal.
      const answer: AskResult = command.allow ? 'allow' : { answer: 'deny', reason: '操作者从 QQ 拒绝了这条命令' };
      const landed = ctx.session.resolveApproval(first.id, answer);
      if (!landed) return { reply: '这条审批已经不在等待了（可能已超时或被别的入口答复）。' };
      return { reply: command.allow ? `已允许：${first.call.name}` : `已拒绝：${first.call.name}` };
    }
  }
}
