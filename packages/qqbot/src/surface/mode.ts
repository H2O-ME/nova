/**
 * `nova qqbot` 的 surface 内容：无人值守 QQ 机器人模式——开放平台 WebSocket 通道
 * 入站消息经每个对端独立 AgentSession 跑一遍内核轮次（`never` 审批策略、
 * perRequestCompact 与 exec 同一通道），最终回答作为被动回复发回。
 *
 * 从 cli 迁入本包（2026-10-01）：产品形态（对端会话编排、启动前置、凭据校验的
 * 文案）属于这个示范包；cli 只注入两个问题——「凭据从哪读」（raw 文档，含
 * `{env:NAME}` 的兑现判定）与「`[qqbot]` 行怎么上色」。
 */
import path from 'node:path';

import {
  sessionsRoot,
  type AgentSession,
  type AgentSurface,
  type KernelEvent,
  type Plugin,
} from '@nova-agent/core';
import type { Kernel } from '@nova-agent/plugins';
import { createQqBotChannel, type QqBotChannel } from '../runtime.js';
import type { Peer } from '../types.js';

/**
 * cli 侧的注入缝：包**不**读 `~/.nova/config.json`（那是宿主配置层），也**不**决定
 * 终端颜色（那是编排方的呈现）。两个读法都必须读 RAW 文档：`loadConfig` 展开后的
 * 快照看不出 `{env:NAME}` 能不能兑现，也看不到进程运行中刚写进的凭据。
 */
export interface QqBotSurfaceDeps {
  /** 「存的东西能不能用」的一句话；undefined = 可用（`config-read.ts` 的规则）。 */
  credentialsProblem(): Promise<string | undefined>;
  /** 当下可用的凭据（读 raw 文档并展开引用）；未配置 = undefined。 */
  readCredentials(): Promise<{ appId: string; clientSecret: string } | undefined>;
  /** `[qqbot]` 行的呈现（cli 注入调色板；测试注入收集器）。 */
  log(line: string): void;
}

/** 装配前置交给内核的东西（cli 把 `SurfaceBoot` 贡献接在这上面）。 */
export interface QqBotSurfaceContribution {
  extraPlugins: readonly Plugin[];
  sessionDir: string;
  perRequestCompact: boolean;
}

export interface QqBotSurfaceParts {
  /** 认领与启动的契约面（cli 用自己的 claim 包一层后注册进注册表）。 */
  surface: AgentSurface;
  /** 装配前置：校验凭据、建通道；返回内核贡献。 */
  prepare(): Promise<QqBotSurfaceContribution>;
  /** 装配完成后回填内核（brain 懒取；cli 随后把策略钉成 `never`）。 */
  attach(kernel: Kernel): void;
}

export function createQqBotSurface(deps: QqBotSurfaceDeps): QqBotSurfaceParts {
  const peerAgents = new Map<string, AgentSession>();
  const holder: { kernel?: Kernel } = {};
  /** 对端会话与启动期的初始会话同归档在 qqbot 子目录（与交互会话隔离）。 */
  const sessionDir = path.join(sessionsRoot(), 'qqbot');
  let channel: QqBotChannel | undefined;
  let appId = '';

  async function runPeerTurn(text: string, peer: Peer): Promise<string> {
    const kernel = holder.kernel;
    if (kernel === undefined) throw new Error('qqbot：内核尚未就绪');
    let agent = peerAgents.get(peer.peerId);
    if (agent === undefined) {
      agent = await kernel.newAgentSession({ sessionDir });
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
          deps.log(
            `[qqbot] ${event.type === 'notice' ? event.text : `已自动压缩 — 保留 ${event.progress.retained ?? 0} 条最近消息`}`,
          );
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

  return {
    surface: {
      name: 'qqbot',
      claim: (request) => request.flags.positional[0] === 'qqbot',
      start: async () => {
        if (channel === undefined) throw new Error('qqbot：装配未产生通道（prepare 未运行）');
        deps.log(`[qqbot] appId ${appId} · 对端独立会话 · 审批 never（read-only 只读工具可用）`);
        deps.log('[qqbot] Ctrl+C 退出（进行中的回复完成当前条后结束）');
        await channel.start();
        const shutdown = (): void => {
          channel?.stop();
          void holder.kernel?.jobs.dispose().catch(() => undefined);
        };
        process.on('SIGINT', () => {
          shutdown();
          process.exit(0);
        });
        // 常驻：等待通道生命周期结束（目前只有 stop/进程退出）。
        await new Promise<never>(() => undefined);
      },
    },
    prepare: async () => {
      // 「能不能用」先于「是什么」：`credentialsProblem` 看得见未兑现的 `{env:NAME}`，
      // 而直接去读会把它当成字面量送去换 token、再报一个看不懂的鉴权失败。
      const problem = await deps.credentialsProblem();
      if (problem !== undefined) throw new Error(problem);
      const creds = await deps.readCredentials();
      if (creds === undefined) {
        throw new Error('qqbot 模式需要在 ~/.nova/config.json 配置 qqbot.appId 与 qqbot.clientSecret（密钥可用 {env:NAME} 引用）');
      }
      appId = creds.appId;
      channel = createQqBotChannel({
        appId: creds.appId,
        clientSecret: creds.clientSecret,
        brain: runPeerTurn,
        log: deps.log,
      });
      return { extraPlugins: [channel.plugin], sessionDir, perRequestCompact: true };
    },
    attach: (kernel) => {
      holder.kernel = kernel;
    },
  };
}
