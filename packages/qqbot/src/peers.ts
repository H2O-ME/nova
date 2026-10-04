/**
 * 对端会话池：一条入站消息 → 那个对端自己的 `AgentSession` → 回复文本。
 *
 * 这是从前的 `surface/peer.ts`：那时「跑哪一轮」由 surface 编排，因为通道由
 * surface 建。现在通道住在插件自己的 fiber 里（见 `plugin.ts`），所以对端编排也归
 * 插件——surface 只剩「认领 argv 并等通道结束」。
 *
 * 依赖从「内核句柄」换成**能力服务**：会话由 `SessionService.open()` 建（它同时把
 * `current` 重绑到这一个对端，所以内核的审计 / job 扇出 / 压缩目标跟着本轮走），
 * 遥控的座位按有则用、无则如实回答（见 `remote.ts`）。
 */
import type { AgentSession, SessionService } from '@nova-agent/core';
import type { Peer } from './types.js';
import { ApprovalForwarder } from './approval.js';
import { parseRemoteCommand } from './remote-parse.js';
import { runRemoteCommand, type RemoteKernelPort } from './remote.js';
import { promptOnce } from './turn.js';

/** 往 QQ 主动推一行（审批问题要用；被动窗口由通道保证）。 */
export type PeerNotifier = (peer: Peer, text: string) => void;

/** 对端编排需要的那几件事实（全部来自容器，没有内核句柄）。 */
export interface PeerTurnDeps {
  /** 会话生命周期：每个对端一份，跨消息复用。 */
  sessions: SessionService;
  /** 对端会话的落点（`sessionsRoot()/qqbot`：与交互会话隔离）。 */
  sessionDir: string;
  /** 本进程的工作区，遥控 `/status` 用；装配没有就给 undefined。 */
  rootDir: () => string | undefined;
  /** 在役模型 id（活读；`llm` 服务缺席时 undefined）。 */
  model: () => string | undefined;
  notify: PeerNotifier;
}

/**
 * 对端的会话池：每个 `peerId` 一个 `AgentSession`，跨消息复用。
 *
 * 复用是必须的——QQ 上的一段对话是**同一段对话**，每条消息都开新会话会让模型在
 * 每一行重新失忆。通道把 `brain` 调用全局串行化了，所以不存在两轮同时占着 `current`。
 */
export class PeerTurns {
  private readonly peers = new Map<string, AgentSession>();
  /** 未答复审批的推送 + 兜底（见 `approval.ts`）。 */
  private readonly approvals: ApprovalForwarder;

  constructor(private readonly deps: PeerTurnDeps) {
    this.approvals = new ApprovalForwarder(deps.notify);
  }

  /**
   * 跑一轮，返回要发回去的文本。
   * @param text - 入站消息。
   * @param peer - 发消息的 QQ 对端。
   * @returns 回复文本。
   */
  async run(text: string, peer: Peer): Promise<string> {
    const parsed = parseRemoteCommand(text);
    if (parsed.command !== undefined) return this.runRemote(parsed.command, peer);
    const agent = await this.agentFor(peer);
    return promptOnce(agent, this.approvals, text, peer);
  }

  /**
   * 插件卸载时的收尾。
   *
   * 在飞的轮次**中止**而不是继续跑：插件关了就该停一切，包括一次正在等模型的调用。
   * 会话本身不销毁——日志是持久事实，而且重建一个 handle 的代价只是重新投影；这里
   * 只放下对它的引用（`current` 由容器管，不由这里管）。审批定时器必须清掉：它们
   * 是这一档激活持有的资源，fiber 走了还在跑就是泄漏。
   */
  dispose(): void {
    this.approvals.dispose();
    for (const agent of this.peers.values()) agent.abort();
    this.peers.clear();
  }

  /** 执行一条遥控指令（在通道的旁路里跑，不占串行队列）。 */
  private async runRemote(
    command: NonNullable<ReturnType<typeof parseRemoteCommand>['command']>,
    peer: Peer,
  ): Promise<string> {
    const agent = await this.agentFor(peer);
    const kernel: RemoteKernelPort = {
      rootDir: () => this.deps.rootDir() ?? '',
      // The model in force is KNOWABLE (the `llm` service publishes it) even
      // though no plugin can SWITCH it: nothing publishes a model catalog to
      // plugins, so `/status` reports the id and `/model` answers honestly that
      // this process has no switching seat (see `remote.ts`).
      model: () => this.deps.model(),
    };
    const outcome = await runRemoteCommand(command, {
      kernel,
      session: {
        setApprovalMode: (mode) => { agent.setApprovalMode(mode); },
        approvalMode: () => agent.approvalMode,
        pendingApprovals: () => agent.pendingApprovals(),
        resolveApproval: (id, answer) => agent.resolveApproval(id, answer),
      },
      // `/new` runs through the ONE command implementation, which hands the new
      // session back; rebinding happens here, where the peer map lives, instead of
      // a second `/new` branch in this class.
      newSession: () => this.newSession(peer),
    });
    if (outcome.nextAgent !== undefined) this.peers.set(peer.peerId, outcome.nextAgent);
    return outcome.reply;
  }

  /** 取（或懒建）这个对端的会话，并让 `current` 跟着本轮走。 */
  private async agentFor(peer: Peer): Promise<AgentSession> {
    const existing = this.peers.get(peer.peerId);
    if (existing === undefined) return this.newSession(peer);
    this.deps.sessions.activate(existing);
    return existing;
  }

  private async newSession(peer: Peer): Promise<AgentSession> {
    // `open` creates AND makes current: a peer's first message must not leave the
    // kernel's audit/job/compaction target on somebody else's conversation.
    const agent = await this.deps.sessions.open({ sessionDir: this.deps.sessionDir });
    this.peers.set(peer.peerId, agent);
    return agent;
  }
}
