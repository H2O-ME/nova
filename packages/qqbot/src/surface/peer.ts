/**
 * 一轮 QQ 对端会话：一条入站消息 → 那个对端自己的 `AgentSession` → 回复文本。
 *
 * 从 `bridge.ts` 拆出，因为它回答的是另一个问题：桥那边管**通道装不装得起来、
 * 跑没跑起来**，这里管**跑起来之后每一轮怎么走**——会话编排（懒建、复用、激活、
 * 订阅收敛）加上遥控指令的落地。
 *
 * 遥控部分复用内核既有接缝，不新造第二套：权限档、审批、换模型、换工作区、开新会话
 * （见 `remote.ts`）。
 */
import type { AgentSession, ApprovalMode } from '@nova-agent/core';
import type { Peer } from '../types.js';
import { ApprovalForwarder } from './approval.js';
import { parseRemoteCommand } from './remote-parse.js';
import { runRemoteCommand, type RemoteKernelPort } from './remote.js';
import { promptOnce } from './turn.js';

/**
 * 内核里 QQ 对端需要的那一小块能力（`WebController` 的 kernel 满足它）。
 *
 * 直接复用 `RemoteKernelPort`（工作区 + 模型座位）再加上会话编排所需的两件事：
 * 「开一个新会话」与「把 current 指到它」。
 */
export interface QqBotKernelPort extends RemoteKernelPort {
  newAgentSession(): Promise<AgentSession>;
  activateSession(agent: AgentSession): void;
}

/** 往 QQ 主动推一行（审批问题要用；被动窗口由通道保证）。 */
export type PeerNotifier = (peer: Peer, text: string) => void;

/**
 * 对端的会话池：每个 `peerId` 一个 `AgentSession`，跨消息复用。
 *
 * 复用是必须的——QQ 上的一段对话是**同一段对话**，每条消息都开新会话会让模型在
 * 每一行重新失忆。`activateSession` 放在每轮开头，让内核的审计 / job 扇出 / 压缩
 * 目标跟随本轮对端（通道把 `brain` 调用全局串行化了，所以不存在两轮同时激活）。
 */
export class PeerTurns {
  private readonly peers = new Map<string, AgentSession>();
  /** 未答复审批的推送 + 兜底（见 `approval.ts`）。 */
  private readonly approvals: ApprovalForwarder;

  constructor(
    private readonly kernel: () => QqBotKernelPort | undefined,
    notify: PeerNotifier = () => undefined,
  ) {
    this.approvals = new ApprovalForwarder(notify);
  }

  /**
   * 跑一轮，返回要发回去的文本。
   * @param text - 入站消息。
   * @param peer - 发消息的 QQ 对端。
   * @returns 回复文本。
   */
  async run(text: string, peer: Peer): Promise<string> {
    const port = this.kernel();
    if (port === undefined) throw new Error('QQ 通道已启动但内核尚未就绪，请稍后重试。');
    const parsed = parseRemoteCommand(text);
    if (parsed.command !== undefined) return this.runRemote(parsed.command, port, peer);

    const agent = await this.agentFor(peer, port);
    port.activateSession(agent);
    return promptOnce(agent, this.approvals, text, peer);
  }

  /** 执行一条遥控指令（在通道的旁路里跑，不占串行队列）。 */
  private async runRemote(
    command: NonNullable<ReturnType<typeof parseRemoteCommand>['command']>,
    port: QqBotKernelPort,
    peer: Peer,
  ): Promise<string> {
    const agent = await this.agentFor(peer, port);
    port.activateSession(agent);
    const outcome = await runRemoteCommand(command, {
      kernel: port,
      session: {
        setApprovalMode: (mode: ApprovalMode) => { agent.setApprovalMode(mode); },
        approvalMode: () => agent.approvalMode,
        pendingApprovals: () => agent.pendingApprovals(),
        resolveApproval: (id, answer) => agent.resolveApproval(id, answer),
      },
      // `/new` runs through the ONE command implementation (which creates the
      // session and hands it back); the rebinding happens here, where the peer map
      // lives, instead of a second `/new` branch in this class.
      newSession: () => port.newAgentSession(),
    });
    if (outcome.nextAgent !== undefined) {
      this.peers.set(peer.peerId, outcome.nextAgent);
      port.activateSession(outcome.nextAgent);
    }
    return outcome.reply;
  }

  /** 取（或懒建）这个对端的会话。 */
  private async agentFor(peer: Peer, port: QqBotKernelPort): Promise<AgentSession> {
    const existing = this.peers.get(peer.peerId);
    if (existing !== undefined) return existing;
    const created = await port.newAgentSession();
    this.peers.set(peer.peerId, created);
    return created;
  }
}
