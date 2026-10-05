/**
 * 对端编排：一条入站消息 → 这个对话**绑定的那段会话** → 回复文本。
 *
 * 这是从前的 `surface/peer.ts`：那时「跑哪一轮」由 surface 编排，因为通道由
 * surface 建。现在通道住在插件自己的 fiber 里（见 `plugin.ts`），所以对端编排也归
 * 插件——surface 只剩「认领 argv 并等通道结束」。
 *
 * 依赖从「内核句柄」换成**能力服务**：会话由 `SessionService` 建/取（它同时把
 * `current` 重绑到这一段，所以内核的审计 / job 扇出 / 压缩目标跟着本轮走），遥控的
 * 座位按有则用、无则如实回答（见 `remote.ts`）。
 *
 * ## 绑定是持久的，这正是本文件存在的理由
 *
 * 每个 QQ 对话绑定到**一份会话日志**（`bindings.ts` 落盘），而不是每次消息现开一段：
 *
 *  - **手机遥控桌面**：对话被接到桌面正在用的那段会话上，于是手机里的一句话**接着**
 *    桌面的上下文走，桌面的转录里也会出现这句话（会话接力）。绑定只存在内存里的话，
 *    一次重启就把接力打断。
 *  - **无 GUI 服务器**：`nova qqbot` 重启后，每个对话必须还在原来的那段会话里，否则
 *    每次重启都悄悄从头开始——那正好是这个形态最不想要的东西。
 */
import type { AgentSession, SessionService } from '@nova-agent/core';
import { clampTier, type AccessTier } from './access.js';
import type { BindingsStore } from './bindings.js';
import type { Peer } from './types.js';
import { PendingAsks } from './ask-forward.js';
import { ProgressRelay } from './progress.js';
import { parseRemoteCommand, splitSlash } from './remote-parse.js';
import { runRemoteCommand, type RelayCandidate, type RemoteKernelPort, type RemoteRelayPort } from './remote.js';
import { promptOnce, type TurnObserver } from './turn.js';

/** 往 QQ 主动推一行（审批问题与过程回传要用；被动窗口由通道保证）。 */
export type PeerNotifier = (peer: Peer, text: string) => void;

/**
 * The kernel's command catalog, as this package sees it.
 *
 * A SEAT rather than a snapshot of names: whether `/compact` exists depends on
 * which plugin rows are loaded, and an operator who switches a plugin off must
 * lose its command in the chat window at the same time as in the browser menu.
 * `run` returns the command's own text because a chat window has nowhere else to
 * put it — the browser reads a `command` event, a peer needs a sentence back.
 */
export interface RemoteCommandSeat {
  /** The live catalog (name only; the help text is built from it). */
  catalog(): readonly { name: string; description: string }[];
  /** Execute one, returning its output; `found: false` means no such command. */
  run(name: string, args: string): Promise<{ found: boolean; text: string }>;
}

/** 对端编排需要的那几件事实（全部来自容器，没有内核句柄）。 */
export interface PeerTurnDeps {
  /** 会话生命周期：绑定与 `current` 的唯一来源。 */
  sessions: SessionService;
  /** 自己新开的会话的落点（`sessionsRoot()/qqbot`：与交互会话隔离）。 */
  sessionDir: string;
  /** The durable chat → session map (see the module header). */
  bindings: BindingsStore;
  /** 本进程的工作区，遥控 `/status` 用；装配没有就给 undefined。 */
  rootDir: () => string | undefined;
  /** 在役模型 id（活读；`llm` 服务缺席时 undefined）。 */
  model: () => string | undefined;
  /** The kernel's slash-command catalog, when this process has one. */
  commands?: RemoteCommandSeat;
  /**
   * The strongest tier a remote peer may take for its own conversation.
   *
   * A THUNK because the operator can lower it in the settings page while a peer
   * is mid-conversation: a ceiling read at construction would keep granting what
   * the page no longer says.
   */
  maxTier?: () => AccessTier;
  /**
   * Whether a question published on these conversations can be answered.
   *
   * Defaulted to `true` because this package now HAS an answer path (`/answer`);
   * an assembly that routes these chats somewhere nobody watches can pass a thunk
   * that says so, and then `ask_user_question` refuses honestly instead of parking
   * a run no card can release.
   */
  canAskUser?: () => boolean;
  notify: PeerNotifier;
}

/**
 * 对话的会话池：每个 `peerId` 一段，跨消息、跨重启复用。
 *
 * 复用是必须的——QQ 上的一段对话是**同一段对话**，每条消息都开新会话会让模型在
 * 每一行重新失忆。通道把 `brain` 调用全局串行化了，所以不存在两轮同时占着 `current`。
 */
export class PeerTurns {
  /** Live handles by chat, so a turn does not re-look-up the binding every event. */
  private readonly peers = new Map<string, AgentSession>();
  /** 未答复审批的推送 + 兜底（见 `approval.ts`）。 */
  private readonly asks: PendingAsks;
  /** Terminal latch: a disposed pool must not open (or reopen) anything. */
  private disposed = false;

  constructor(private readonly deps: PeerTurnDeps) {
    this.asks = new PendingAsks(deps.notify);
  }

  /**
   * 跑一轮，返回要发回去的文本。
   *
   * Four doors, in this order, and the order is the design:
   *
   *  1. a verb this package OWNS (`/perm`, `/approve`, `/use`, …) — it has kernel
   *     seats the catalog cannot express (approving an outstanding ask, pointing
   *     this chat at somebody else's conversation);
   *  2. a name the KERNEL's live catalog owns (`/compact`, `/goal`, `/mode`, and
   *     anything a third-party plugin registered) — resolved LIVE, so a command
   *     appears here exactly when it is loaded, and switches off with its row;
   *  3. everything else, verbatim, as a prompt.
   *
   * The last door is why this is a chain and not a whitelist: a peer's text must
   * never be swallowed by a parser that did not understand it, so the final
   * fallback is always "ask the model what they said".
   * @param text - 入站消息。
   * @param peer - 发消息的 QQ 对端。
   * @returns 回复文本；空串表示「这一轮已经自己把话说完并送出去了」。
   */
  async run(text: string, peer: Peer): Promise<string> {
    const parsed = parseRemoteCommand(text);
    if (parsed.command !== undefined) return this.runRemote(parsed.command, peer);
    const slash = splitSlash(text);
    const commands = this.deps.commands;
    if (slash !== undefined && commands !== undefined && this.hasCommand(commands, slash.name)) {
      const outcome = await commands.run(slash.name.slice(1), slash.args);
      return outcome.text.length > 0 ? outcome.text : `/${slash.name.slice(1)} 执行完毕（无输出）。`;
    }
    const agent = await this.agentFor(peer);
    // Live narration: the phone hears what the agent is doing while it works, not
    // only after it stops. Delivery moves HERE when it is on, so the caller must
    // send nothing (an empty return) or the peer would read the answer twice.
    const relay = new ProgressRelay({ send: (line) => { this.deps.notify(peer, line); } });
    const observer: TurnObserver = {
      accepted: () => { relay.accepted(); },
      tool: (name) => { relay.tool(name); },
    };
    const result = await promptOnce(agent, this.asks, text, peer, observer);
    // The ANSWER is RETURNED, not relayed. `notify` is the NARRATION class, capped
    // below the reply allowance on purpose so a busy turn cannot spend the answer's
    // reserve — so delivering the answer through it made the one message the peer
    // was waiting for the one message that could be dropped. Returning it hands it
    // to the channel's reply seat, which spends the reserve.
    if (result.reply.trim().length === 0) {
      // Nothing to say: the "finished, no text" line is narration, and there is
      // nothing for the caller to deliver.
      relay.final(result.reply);
      return '';
    }
    return result.reply;
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
    this.disposed = true;
    this.asks.dispose();
    for (const agent of this.peers.values()) agent.abort();
    this.peers.clear();
  }

  /** Is this `/name` one the kernel currently owns? (Re-read per call: rows flip.) */
  private hasCommand(seat: RemoteCommandSeat, slashName: string): boolean {
    const name = slashName.slice(1);
    return name.length > 0 && seat.catalog().some((entry) => entry.name === name);
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
        abort: () => { agent.abort(); },
        running: () => agent.running,
        pendingQuestions: () => agent.pendingQuestions(),
        resolveQuestion: (id, answer) => agent.resolveQuestion(id, answer),
      },
      maxTier: this.deps.maxTier?.(),
      relay: this.relayPort(agent, peer),
      // `/new` runs through the ONE command implementation, which hands the new
      // session back; rebinding happens here, where the peer map lives, instead of
      // a second `/new` branch in this class.
      newSession: () => this.newSession(peer),
    });
    if (outcome.nextAgent !== undefined) this.peers.set(peer.peerId, outcome.nextAgent);
    return outcome.reply;
  }

  /**
   * The relay seat: which OTHER conversations this chat may be pointed at.
   *
   * `mine` is computed against the handle this chat currently drives, so the
   * listing answers "where am I" as well as "what else is there" — a peer who
   * cannot see which conversation they are in cannot safely `/use` another.
   */
  private relayPort(current: AgentSession, peer: Peer): RemoteRelayPort {
    const mineFile = current.session.file;
    const candidateOf = (agent: AgentSession): RelayCandidate => ({
      target: shortHandle(agent.session.id),
      id: agent.session.id,
      where: lastSegment(this.deps.rootDir() ?? '') || '（未设置工作区）',
      busy: agent.running,
      mine: agent.session.file === mineFile,
    });
    return {
      list: async () => this.deps.sessions.list().map(candidateOf),
      use: async (target) => {
        const matches = this.deps.sessions
          .list()
          .filter((agent) => agent.session.id.startsWith(target) || shortHandle(agent.session.id) === target);
        if (matches.length === 0) return { ok: false, reason: `没有以 ${target} 开头的活会话（用 /sessions 看清单）。` };
        // Ambiguity is refused rather than resolved by picking the first: the peer
        // asked for one conversation and silently attaching them to another is
        // exactly the "switch that landed somewhere else" this command exists to
        // avoid.
        if (matches.length > 1) return { ok: false, reason: `${target} 匹配到 ${matches.length} 个会话，请多打几位。` };
        const chosen = matches[0];
        if (chosen === undefined) return { ok: false, reason: '内部错误：匹配到的会话不见了。' };
        await this.bind(peer, { kind: 'relay', file: chosen.session.file });
        this.peers.set(peer.peerId, chosen);
        // Binding a relay does NOT steal the kernel's `current`: the selection a
        // desktop is showing belongs to the desktop. `activate` happens per turn,
        // in `agentFor`, so audit and job fan-out follow the turn being run.
        return { ok: true, candidate: candidateOf(chosen) };
      },
      unbind: async () => {
        await this.deps.bindings.clear(peer.peerId);
        this.peers.delete(peer.peerId);
      },
      bound: () => {
        const binding = this.deps.bindings.get(peer.peerId);
        if (binding === undefined || binding.kind !== 'relay') return undefined;
        return candidateOf(current);
      },
    };
  }

  /**
   * 取（或懒建）这个对话的会话，并让 `current` 跟着本轮走。
   *
   * The order matters and is the whole point of the durable binding: an ALREADY
   * LIVE handle for the bound log wins, because opening a second handle on one log
   * puts two writers on it. Only when nobody holds it does this resume from the
   * file — which is how a restart rejoins the same conversation.
   */
  private async agentFor(peer: Peer): Promise<AgentSession> {
    const bound = this.deps.bindings.get(peer.peerId);
    if (bound !== undefined) {
      const live = this.deps.sessions.list().find((agent) => agent.session.file === bound.file);
      if (live !== undefined) {
        this.peers.set(peer.peerId, live);
        this.deps.sessions.activate(live);
        return live;
      }
      const held = this.peers.get(peer.peerId);
      if (held !== undefined && held.session.file === bound.file && !held.disposed) {
        this.deps.sessions.activate(held);
        return held;
      }
      return await this.resume(peer, bound);
    }
    const existing = this.peers.get(peer.peerId);
    if (existing !== undefined && !existing.disposed) {
      this.deps.sessions.activate(existing);
      return existing;
    }
    return await this.newSession(peer);
  }

  /** Reopen a bound log, keeping the binding's kind (a relay stays a relay). */
  private async resume(peer: Peer, bound: { kind: 'own' | 'relay'; file: string }): Promise<AgentSession> {
    const agent = await this.open({ resumeFile: bound.file });
    // A conversation this chat OWNS is subject to the remote ceiling like a fresh
    // one; a RELAY is somebody else's conversation and must not be re-tiered.
    if (bound.kind === 'own') this.capOwnedTier(agent);
    this.peers.set(peer.peerId, agent);
    // The file can change on resume in principle (it does not today, but the
    // binding is the durable fact and must record what actually opened).
    if (agent.session.file !== bound.file) await this.bind(peer, { kind: bound.kind, file: agent.session.file });
    return agent;
  }

  private async newSession(peer: Peer): Promise<AgentSession> {
    const agent = await this.open({});
    this.capOwnedTier(agent);
    this.peers.set(peer.peerId, agent);
    await this.bind(peer, { kind: 'own', file: agent.session.file });
    return agent;
  }

  /**
   * Clamp a conversation this chat OWNS to the channel's tier ceiling.
   *
   * `maxTier` used to be enforced only on `/perm`, so it governed the VERB and not
   * the execution: a machine running at `full` (`config.approval`) handed every
   * bound peer a `full` conversation, and the operator's ceiling did nothing until
   * the peer happened to type `/perm`. The tier is a per-session fact, so it is
   * clamped at the moment the conversation is created.
   *
   * Deliberately NOT applied to a RELAYED conversation: lowering a desktop
   * session's tier because a phone pointed at it would let the remote ceiling
   * contaminate the desktop. Capping a relayed call needs the ceiling to travel
   * with the CALLER (a per-call principal), which this channel does not have yet.
   * @param agent - the conversation just opened for this chat.
   */
  private capOwnedTier(agent: AgentSession): void {
    const ceiling: AccessTier = this.deps.maxTier?.() ?? 'read-only';
    const mode = agent.approvalMode;
    if (mode === undefined) return;
    const capped = clampTier(mode, ceiling);
    if (capped !== mode) agent.setApprovalMode(capped);
  }

  /**
   * Open through the service, which is what makes this the current session.
   *
   * `canAskUser: () => false` is not a policy this file invents: a bot peer has
   * nobody watching ITS stream, so a question card published here would park the
   * run with nothing able to release it. Refusing is what makes
   * `ask_user_question` answer the model honestly instead.
   */
  private async open(options: { resumeFile?: string }): Promise<AgentSession> {
    if (this.disposed) {
      // A pool that has been torn down must not start new work: the plugin that
      // owned it is gone, so a conversation opened here would have no surface.
      throw new Error('qqbot: this conversation pool was disposed');
    }
    return await this.deps.sessions.open({
      sessionDir: this.deps.sessionDir,
      ...(options.resumeFile !== undefined ? { resumeFile: options.resumeFile } : {}),
      // A chat peer CAN be asked: questions are forwarded to it and answered with
      // `/answer` (`question-reply.ts` maps the prose onto the kernel's batch).
      // This used to be `false`, which made every question refuse with
      // NO_PROVIDER — honest, but it meant the agent could never ask the person
      // who was right there in the chat window.
      canAskUser: () => this.deps.canAskUser?.() ?? true,
    });
  }

  private async bind(peer: Peer, binding: { kind: 'own' | 'relay'; file: string }): Promise<void> {
    await this.deps.bindings.set(peer.peerId, binding);
  }
}

/** A short, typeable handle derived from a session id (stable per session). */
function shortHandle(sessionId: string): string {
  return sessionId.slice(0, 6).toLowerCase();
}

/** Last path segment, so a chat can tell conversations in different roots apart. */
function lastSegment(dir: string): string {
  const parts = dir.split(/[\\/]/u).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? '';
}


