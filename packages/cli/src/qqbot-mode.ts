import path from 'node:path';

import type { AgentSession, KernelEvent } from '@nova-agent/core';
import { createQqBotChannel, type Peer, type QqBotChannel } from '@nova-agent/qqbot';
import { bootKernel, createProvider } from './kernel-boot.js';
import type { Config } from './config.js';
import { sessionsRoot } from './config.js';
import { resolvePaint, type Paint } from './lines.js';

export interface QqBotOptions {
  rootDir: string;
  config: Config;
}

/**
 * `nova qqbot` — 无人值守 QQ 机器人模式：开放平台 WebSocket 通道入站消息
 * 经每个对端独立 AgentSession 跑一遍内核轮次（`never` 审批策略、
 * perRequestCompact 与 exec 同一通道），最终回答作为被动回复发回。
 *
 * M11 批1c：此前每对端手写一份 session/messages 对 + 可变 currentRef holder；
 * 现在对端会话 = `kernel.newAgentSession()`（各自日志 + 活事件面），每轮开头
 * `activateSession` 重指 current——审批审计、job 扇出、请求内压缩目标随之一致。
 */
export async function startQqBot(opts: QqBotOptions): Promise<void> {
  const { rootDir, config } = opts;
  const qq = config.qqbot;
  if (qq === undefined) {
    throw new Error('qqbot 模式需要在 ~/.nova/config.json 配置 qqbot.appId 与 qqbot.clientSecret（密钥可用 {env:NAME} 引用）');
  }
  // 调色板装配单源 resolvePaint：尊重 ui.theme 与 NO_COLOR/TERM=dumb。
  const paint: Paint = resolvePaint(config.ui?.theme ?? 'dark');

  const client = createProvider(config);
  const peerAgents = new Map<string, AgentSession>();
  const log = (line: string): void => console.log(paint.dim(`[qqbot] ${line}`));

  const channel: QqBotChannel = createQqBotChannel({
    appId: qq.appId,
    clientSecret: qq.clientSecret,
    brain: async (text, peer) => runPeerTurn(text, peer),
    log,
  });

  const kernel = await bootKernel({
    rootDir,
    config,
    provider: client,
    extraPlugins: [channel.plugin],
    // 对端会话与启动期的初始会话同归档在 qqbot 子目录（与交互会话隔离）。
    sessionDir: path.join(sessionsRoot(), 'qqbot'),
    perRequestCompact: true,
    // 无人值守：'never' 策略确定性拒绝（连询问器都不派发，exec 同款）。
    policy: 'never',
  });

  async function runPeerTurn(text: string, peer: Peer): Promise<string> {
    let agent = peerAgents.get(peer.peerId);
    if (agent === undefined) {
      agent = await kernel.newAgentSession({ sessionDir: path.join(sessionsRoot(), 'qqbot') });
      peerAgents.set(peer.peerId, agent);
    }
    // 全局串行调用（通道契约）：current 重绑让审计/job/压缩目标跟随本轮对端；
    // provider 的缓存亲和由 sessions 服务在 activate 时一并重绑。
    kernel.activateSession(agent);

    let reply = '';
    let failure: string | undefined;
    const finished = new Promise<void>((resolve) => {
      const unsubscribe = agent.subscribe((event: KernelEvent) => {
        // 最终 assistant 回复捕获为被动回复正文（"model-visible means
        // logged" 由内核落账，这里只是对端的呈现面）。
        if (event.type === 'message' && event.message.role === 'assistant' && event.message.content.trim().length > 0) {
          reply = event.message.content.trim();
        } else if (event.type === 'run_failed') {
          failure = event.message;
        } else if (event.type === 'notice' || (event.type === 'compaction' && event.progress.state === 'done')) {
          log(event.type === 'notice' ? event.text : `已自动压缩 — 保留 ${event.progress.retained ?? 0} 条最近消息`);
        }
        if (event.type === 'phase' && event.phase === 'idle') {
          unsubscribe();
          resolve();
        }
      });
    });
    await agent.prompt(text);
    await finished;
    if (failure !== undefined) throw new Error(failure); // 报错上抛给通道层回复
    return reply;
  }

  console.log(`[qqbot] appId ${qq.appId} · 对端独立会话 · 审批 never（read-only 只读工具可用）`);
  console.log('[qqbot] Ctrl+C 退出（进行中的回复完成当前条后结束）');
  await channel.start();
  const shutdown = (): void => {
    channel.stop();
    void kernel.jobs.dispose().catch(() => undefined);
  };
  process.on('SIGINT', () => {
    shutdown();
    process.exit(0);
  });
  // 常驻：等待通道生命周期结束（目前只有 stop/进程退出）。
  await new Promise<never>(() => undefined);
}
