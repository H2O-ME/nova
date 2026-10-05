/**
 * 遥控：把一条认得的指令**真的接到内核上**（`remote-parse.ts` 只负责认字）。
 *
 * Functionally it consumes exactly three seams, so it works for whoever holds
 * them; a channel plugin holds the per-peer session and whatever seats the host
 * published, and every seat it does NOT hold answers honestly instead of
 * pretending a switch landed:
 *  - **权限档** → `AgentSession.setApprovalMode()`
 *  - **审批** → 不自动拒绝：把请求发到 QQ、等对端回 `/approve` / `/deny`，走
 *    `pendingApprovals()` / `resolveApproval()`。超时**必定拒绝**（fail-closed）。
 *  - **换模型** → 模型座位（有才有，没有就说没有）
 *  - **工作区** → 工作区座位（同上；校验与拒绝归内核）
 *  - **会话** → 注入的 `newSession()`，由调用方换掉自己那份对端表
 *
 * 全部依赖注入，所以每一条都能对着假实现直接驱动，不需要网络也不需要真内核。
 */
import { errMessage } from '@nova-agent/core';
import type {
  AgentSession,
  ApprovalMode,
  AskResult,
  AskUserQuestionAnswer,
  AskUserQuestionItem,
} from '@nova-agent/core';
import { clampTier, tierLabel, type AccessTier } from './access.js';
import { parseAnswer } from './question-reply.js';
import type { RemoteCommand, RemotePerm } from './remote-parse.js';

/**
 * The kernel capabilities remote control needs — exactly the seats named in the
 * module header and nothing else.
 *
 * `models` and `setWorkspace` are OPTIONAL because a plugin is handed
 * capabilities, not the kernel: no capability moves the workspace today, so a
 * peer's `/ws` must say so rather than claim a move that never happened. Absent
 * is a fact to report, not a silent no-op — the same discipline `/model` already
 * followed for a process with no model seat.
 */
export interface RemoteKernelPort {
  /** Move the workspace, when this process has a seat for it. Absent = it does not. */
  setWorkspace?(dir: string): Promise<unknown>;
  rootDir(): string;
  /**
   * The model id in force — a READ, separate from the switching seat below.
   * A process can know which model it is sending without being able to change
   * it, and `/status` must be able to say so.
   */
  model?(): string | undefined;
  /** The model switching seat (list + select), when this process has one. */
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
  /** Interrupt the current run (the remote Ctrl+C). */
  abort(): void;
  /** Whether a run is in flight, so `/stop` can answer honestly. */
  running(): boolean;
  /** The outstanding `ask_user_question` batches, for `/answer`. */
  pendingQuestions(): readonly { id: string; questions: readonly AskUserQuestionItem[] }[];
  resolveQuestion(id: string, answer: AskUserQuestionAnswer): boolean;
}

/** How long a remote approval waits before it fails closed. */
export const REMOTE_APPROVAL_TIMEOUT_MS = 3 * 60_000;

/** 权限档 → 中文读数（与设置页 / REPL 同一套词汇）。 */
const PERM_LABEL: Readonly<Record<RemotePerm, string>> = {
  'read-only': '只读',
  'auto-edit': '自动编辑',
  full: '全放行',
};

/**
 * `/help`: the vocabulary IS the manual.
 *
 * Built from the seats this process actually has, because a help line for a
 * command that can only answer "this process has no seat for that" teaches the
 * peer a command that will not work. The commands that always work (permission
 * tier, approvals, a new session) are always listed.
 * @param kernel - the seats in force.
 * @returns the help text.
 */
export function remoteHelp(kernel: RemoteKernelPort): string {
  const lines = [
    '可用遥控指令：',
    '/status — 看当前工作区 / 模型 / 权限 / 待审批',
    '/perm read-only|auto-edit|full — 切换权限档',
  ];
  if (kernel.models !== undefined) lines.push('/model — 列出可选模型；/model <id> — 切换');
  lines.push('/ws — 看当前工作区');
  if (kernel.setWorkspace !== undefined) lines.push('/ws <目录> — 切换工作区');
  lines.push(
    '/new — 为这个对话开一个新会话',
    '/approve — 允许待审批的命令；/deny — 拒绝',
    '/help — 这份清单',
    '（不认得的 / 开头行、以及所有其它文本，都原样作为提示词发给 agent。）',
  );
  return lines.join('\n');
}

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

/**
 * One live conversation this chat could drive instead of its own.
 *
 * `target` is the short handle a peer types (`/use a1b2c3`), derived from the
 * session id so it is stable for the life of that session. `mine` says whether it
 * is already the one this chat is driving.
 */
export interface RelayCandidate {
  /** The short, typeable handle (`/use <target>`). */
  target: string;
  /** The session id, for a reply that wants to be unambiguous. */
  id: string;
  /** Where it runs (last path segment), so the peer can tell conversations apart. */
  where: string;
  /** Whether a run is in flight right now. */
  busy: boolean;
  /** Whether this chat already drives it. */
  mine: boolean;
}

/**
 * Session relay: the phone-driving-a-desktop seat.
 *
 * Separate from `RemoteKernelPort` because these are operations on OTHER
 * conversations, not on the one this chat is already in — and absent means this
 * deployment has no relay (a channel whose sessions are all its own), which the
 * commands report rather than pretending a switch landed.
 */
export interface RemoteRelayPort {
  list(): Promise<readonly RelayCandidate[]>;
  /** Point this chat at one conversation. Refuses an unknown/ambiguous handle. */
  use(target: string): Promise<{ ok: true; candidate: RelayCandidate } | { ok: false; reason: string }>;
  /** Let go: this chat owns a fresh conversation again. */
  unbind(): Promise<void>;
  /** The conversation this chat is driving now, when it came from a relay. */
  bound(): RelayCandidate | undefined;
}

/** 执行一条指令所需的全部接缝。 */
export interface RemoteContext {
  kernel: RemoteKernelPort;
  session: RemoteSessionPort;
  /** 为这个对端开一个新会话（`/new`）；调用方据此换绑自己那份对端表。 */
  newSession: () => Promise<AgentSession>;
  /** Session relay, when this deployment has other conversations to offer. */
  relay?: RemoteRelayPort;
  /**
   * The strongest tier a REMOTE peer may set for its own conversation.
   *
   * Enforced here rather than in the parser or the menu, because this is the
   * operation that changes the tier: an `/perm full` arriving from a chat window
   * must be capped by what the operator granted locally, and a check anywhere
   * else would leave the execution path able to exceed it. Absent means the
   * machine's own default (`read-only`) — never "unlimited".
   */
  maxTier?: AccessTier;
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
  const model = ctx.kernel.models?.current() ?? ctx.kernel.model?.() ?? '未知（本进程没有模型读数）';
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
      return { reply: remoteHelp(ctx.kernel) };
    case 'status':
      return { reply: statusText(ctx) };
    case 'perm': {
      // The ceiling is applied to what LANDS, not to what was asked: a peer that
      // asks for more than the operator granted is told so, instead of silently
      // getting the smaller tier and believing it holds the bigger one.
      const ceiling = ctx.maxTier ?? 'read-only';
      if (clampTier(command.mode, ceiling) !== command.mode) {
        return {
          reply: `远端权限最高只能到「${tierLabel(ceiling)}」；要更高请在操作这台机器的那一侧打开（并提高上限）。`,
        };
      }
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
      const seat = ctx.kernel.setWorkspace;
      // No seat: the honest answer. Saying "已切换" here would be the exact
      // failure this command family exists to avoid — a reply that reads as
      // done while the kernel never moved.
      if (seat === undefined) return { reply: '这个进程没有工作区座位，换工作区请在界面里操作。' };
      try {
        await seat(command.dir ?? '');
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
    case 'sessions': {
      const relay = ctx.relay;
      if (relay === undefined) return { reply: '这个进程没有会话接力的座位：它只服务自己的会话。' };
      const candidates = await relay.list();
      if (candidates.length === 0) return { reply: '现在没有活着的会话。' };
      const rows = candidates.map((candidate) => {
        const marks = [candidate.mine ? '← 本对话' : '', candidate.busy ? '（进行中）' : ''].filter((m) => m.length > 0);
        return `- ${candidate.target} · ${candidate.where}${marks.length > 0 ? ` ${marks.join(' ')}` : ''}`;
      });
      return { reply: `活着的会话：\n${rows.join('\n')}\n用 /use <前几位> 把本对话接到其中一个上。` };
    }
    case 'use': {
      const relay = ctx.relay;
      if (relay === undefined) return { reply: '这个进程没有会话接力的座位：它只服务自己的会话。' };
      const outcome = await relay.use(command.target);
      if (!outcome.ok) return { reply: `没有切换：${outcome.reason}` };
      const { candidate } = outcome;
      return {
        reply: `本对话现在接到 ${candidate.target}（${candidate.where}）${candidate.busy ? '，它正在跑一轮任务——你的下一条消息会排在它后面。' : '。'}`,
      };
    }
    case 'unbind': {
      const relay = ctx.relay;
      if (relay === undefined) return { reply: '这个进程没有会话接力的座位：它只服务自己的会话。' };
      const bound = relay.bound();
      await relay.unbind();
      return {
        reply: bound === undefined
          ? '本对话本来就没有接在别人的会话上。'
          : `已放开 ${bound.target}；本对话会从自己的一个空会话重新开始。`,
      };
    }
    case 'stop': {
      // Read BEFORE aborting: afterwards `running` is already false, and a reply
      // built from the post-state could not tell "I stopped it" from "nothing was
      // running" — two answers the peer acts on differently.
      const wasRunning = ctx.session.running();
      ctx.session.abort();
      return {
        reply: wasRunning
          ? '已中止这一段会话正在跑的任务。'
          : '这一段会话现在没有在跑的任务（若它在等审批或提问，用 /deny 或 /answer 处理）。',
      };
    }
    case 'answer': {
      const pending = ctx.session.pendingQuestions();
      const first = pending[0];
      if (first === undefined) {
        return { reply: '现在没有待回答的问题。' };
      }
      const parsed = parseAnswer(first.questions, command.text);
      if (!parsed.ok) return { reply: `回答没有送出：${parsed.reason}` };
      // The kernel validates the batch against the questions it asked, so a
      // mapping this side got wrong is REFUSED there rather than silently
      // answering something else.
      if (!ctx.session.resolveQuestion(first.id, parsed.answer)) {
        return { reply: '这条提问已经不在等待了（可能已超时或被别的入口答复）。' };
      }
      const chosen = parsed.answer.answers
        .map((item) => item.custom ?? item.selected.join('、'))
        .filter((value) => value.length > 0);
      return { reply: chosen.length > 0 ? `已答复：${chosen.join('；')}` : '已提交答复。' };
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
