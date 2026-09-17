import path from 'node:path';
import { runAgent, Session, type AgentMessage } from '@nova-agent/core';
import { createQqBotChannel, type Peer, type QqBotChannel } from '@nova-agent/qqbot';
import { wrapHeadlessAutoCompact } from './auto-compact.js';
import { compactSession } from './compact.js';
import type { Config } from './config.js';
import { createSessionRuntime } from './session-runtime.js';
import { sessionsRoot } from './config.js';
import { recordSessionWorkspace } from './sessions.js';
import { agentRunBase, attachHooks, createHeadlessPermission, requireActive } from './runner-shared.js';
import { commitUserMessage, createRunnerBookkeeping, repairTurnLog } from './runner-loop.js';
import { detectCaps } from '@nova-agent/tui';
import { resolvePalette } from '@nova-agent/tui-view';

export interface QqBotOptions {
  rootDir: string;
  config: Config;
}

/**
 * `nova qqbot` — 无人值守 QQ 机器人模式：开放平台 WebSocket 通道入站消息
 * 经每个对端独立会话跑一遍 agent 循环（read-only + never 策略，无交互审批；
 * 自动压缩与 exec 同一 wrapAutoCompact 通道），最终回答作为被动回复发回。
 *
 * 每个对端（群/单聊）一个独立 Session 文件（sessionsRoot()/qqbot/ 下），
 * 上下文互不串线；brain 由通道全局串行调用（共享 client 的会话亲和按
 * 会话切换，低流量下串行即可）。
 */
export async function startQqBot(opts: QqBotOptions): Promise<void> {
  const { rootDir, config } = opts;
  const qq = config.qqbot;
  if (qq === undefined) {
    throw new Error('qqbot 模式需要在 ~/.nova/config.json 配置 qqbot.appId 与 qqbot.clientSecret（密钥可用 {env:NAME} 引用）');
  }
  // 调色板装配单源 resolvePalette（与 repl/tui 同路）：开始尊重 ui.theme 与
  // NO_COLOR/TERM=dumb。
  const paint = resolvePalette(config.ui?.theme ?? 'dark', detectCaps());

  const peerSessions = new Map<string, { session: Session; messages: AgentMessage[] }>();
  // Rebindable holders accessed through requireActive — agents run only after
  // peerSessionOf binds them, so undefined is a wiring bug, not a normal path.
  const currentRef: { value: { session: Session; messages: AgentMessage[] } | undefined } = { value: undefined };
  let hooksRef: import('@nova-agent/core').AgentHooks | undefined;

  const channel: QqBotChannel = createQqBotChannel({
    appId: qq.appId,
    clientSecret: qq.clientSecret,
    brain: async (text, peer) => runPeerTurn(text, peer),
    log: (line) => console.log(paint.dim(`[qqbot] ${line}`)),
  });

  const rt = await createSessionRuntime({
    rootDir,
    config,
    extraPlugins: [channel.plugin],
  });
  // 无人值守：ask 一律拒绝 + never 策略确定性拒绝（exec 同款，装配单源）。
  const permission = createHeadlessPermission(rt.approvalMode);
  const hooks = attachHooks(rt.host, permission, rt.hooksRef);
  hooksRef = hooks;
  // 接线单源在 wrapHeadlessAutoCompact（splice 原位契约 + 文案）；qqbot
  // 压缩成功不播提示。
  wrapHeadlessAutoCompact(hooks, {
    limit: config.autoCompactTokenLimit,
    compact: (msgs: AgentMessage[]) => {
      const target = currentRef.value;
      if (target === undefined) return Promise.resolve({ surface: msgs.slice() });
      return compactSession({ client: rt.client, session: target.session, messages: msgs, trigger: 'auto' });
    },
    onError: (text) =>
      console.log(paint.dim(`[qqbot] ${text}`)),
    onWarn: (text) => console.log(paint.dim(`[qqbot] ${text}`)),
  });

  const agentRun = agentRunBase({
    client: rt.client,
    session: () => requireActive(currentRef.value, 'session').session,
    rootDir: () => rootDir,
    messages: () => requireActive(currentRef.value, 'messages').messages,
    tools: () => rt.host.tools,
    hooks: () => requireActive(hooksRef, 'hooks'),
    jobs: rt.jobs,
    systemPrompt: rt.systemPrompt,
    maxTurns: config.maxTurns,
  });

  // 事件消费簿记单源（runner-loop）：对端会话重绑经访问器取当前值；
  // usage 只累计 stats（无头 runner 不持 pre-flight 锚点态）。
  const bookkeeping = createRunnerBookkeeping({
    session: () => requireActive(currentRef.value, 'session').session,
    stats: rt.stats,
  });

  async function peerSessionOf(peer: Peer): Promise<{ session: Session; messages: AgentMessage[] }> {
    const hit = peerSessions.get(peer.peerId);
    if (hit !== undefined) return hit;
    // 每对端一个会话文件，按 qqbot 子目录归档，与交互会话隔离。
    const session = await Session.create(path.join(sessionsRoot(), 'qqbot'));
    await recordSessionWorkspace(session, rootDir);
    const messages: AgentMessage[] = [];
    rt.client.setSessionId(session.id);
    await rt.seedContextFragment(session, messages);
    const fresh = { session, messages };
    peerSessions.set(peer.peerId, fresh);
    return fresh;
  }

  async function runPeerTurn(text: string, peer: Peer): Promise<string> {
    const bound = await peerSessionOf(peer);
    currentRef.value = bound;
    rt.client.setSessionId(bound.session.id);
    await commitUserMessage(bound.session, bound.messages, text);

    let reply = '';
    try {
      for await (const event of runAgent(agentRun())) {
        // 最终 assistant 回复捕获为被动回复正文；簿记（含该条消息的日志追加
        // ——此前最终回复漏 append，违反 "model-visible means logged"）单源
        // 在 runner-loop。
        if (event.type === 'message' && event.message.role === 'assistant' && event.message.content.trim().length > 0) {
          reply = event.message.content.trim();
        }
        await bookkeeping.apply(event);
      }
    } catch (err) {
      // 修日志单源（runner-loop.repairTurnLog）：报错照旧上抛给通道层。
      await repairTurnLog(bound.session, bound.messages);
      throw err;
    }
    return reply;
  }

  console.log(`[qqbot] appId ${qq.appId} · 对端独立会话 · 审批 never（read-only 只读工具可用）`);
  console.log('[qqbot] Ctrl+C 退出（进行中的回复完成当前条后结束）');
  await channel.start();
  const shutdown = (): void => {
    channel.stop();
    void rt.jobs.dispose().catch(() => undefined);
  };
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  // 常驻：等待通道生命周期结束（目前只有 stop/进程退出）。
  await new Promise<never>(() => undefined);
}
