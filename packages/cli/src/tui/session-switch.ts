/**
 * /session 会话切换（阶段 E 出壳）：重绑 append-only 日志与消息面、跟随
 * 会话回到其工作区（含 ~/.nova 数据目录安全护栏），并把 user/assistant 文本
 * 回放进全新转录（工具流量留在日志里，不重渲染）。壳层突变（rebind/簿记/
 * 清场）全经注入回调——本模块零可变引用，回放序列可独立直测。
 */
import { errMessage, type AgentMessage, type Session } from '@nova-agent/core';
import path from 'node:path';
import type { Palette } from '@nova-agent/tui-view';
import { renderMarkdownLite } from '../markdown.js';
import { ASSISTANT_GUTTER, USER_GUTTER } from './gutters.js';
import type { TuiStore } from './store.js';

export interface SessionSwitchDeps {
  store: TuiStore;
  paint(): Palette;
  loadSession(file: string): Promise<Session>;
  /** 该会话记录的工作区（undefined = 旧日志未记录）。 */
  workspaceOf(loaded: Session): string | undefined;
  /** 当前工具根（护栏/不存在提示行的文案用）。 */
  currentRoot(): string;
  /** 目标是否指向 nova 数据目录——永不作为工作区应用。 */
  isInDataDir(dir: string): boolean;
  /** 目标目录是否存在。 */
  dirExists(dir: string): boolean;
  /** 应用工作区切换（与 switch_workspace 工具同一通道）。 */
  applyWorkspace(dir: string): Promise<void>;
  /** 重绑壳层的 session/messages 绑定（切换成功后两者指向新会话）。 */
  rebind(loaded: Session, restored: AgentMessage[]): void;
  /** rebind 后的簿记：缓存亲和重绑、stats/锚点归零、转录与活行清场。 */
  afterRebind(loaded: Session): void;
  render(): void;
}

/** 可回放的文本消息判据：注入片段（`<…` 开头）与空内容不进转录。 */
function isUserVisibleText(m: AgentMessage): boolean {
  return (m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0 && !m.content.trimStart().startsWith('<');
}

export async function switchSessionTo(deps: SessionSwitchDeps, entry: { file: string }): Promise<void> {
  const { store } = deps;
  const paint = deps.paint();
  if (store.streaming || store.compactRunning) {
    store.pushBlock([paint.yellow('  当前轮未结束：先 Esc 中断，再切换会话')]);
    deps.render();
    return;
  }
  let loaded: Session;
  try {
    loaded = await deps.loadSession(entry.file);
  } catch (err) {
    store.pushBlock([deps.paint().red(`  ✗ 会话读取失败：${errMessage(err)}`)]);
    deps.render();
    return;
  }
  const restored = loaded.deriveMessages();
  deps.rebind(loaded, restored);
  // Corruption tolerance reported at open: surface it like the REPL does —
  // a skipped damaged row or a repaired tail is worth knowing about.
  for (const warning of loaded.warnings) {
    store.pushBlock([deps.paint().yellow(`  ⚠ ${warning}`)]);
  }
  deps.afterRebind(loaded);
  // Follow the session back to the workspace it was created in, so the
  // restored context fragment and the tools' root agree again. Safety rail:
  // ~/.nova (sessions/skills/cache) is NEVER a valid workspace — a session
  // accidentally created inside the data dir must not drag the tools there.
  const p = deps.paint();
  let workspaceLine: string | undefined;
  const target = deps.workspaceOf(loaded);
  if (target !== undefined && deps.isInDataDir(target)) {
    workspaceLine = `${p.yellow(`  ⚠ 会话记录的工作区指向 nova 数据目录（${target}），已忽略`)} ${p.dim(`（工具保持 ${deps.currentRoot()}）`)}`;
  } else if (target !== undefined && target !== deps.currentRoot()) {
    if (deps.dirExists(target)) {
      await deps.applyWorkspace(target);
      workspaceLine = `${p.green('  ✓ 工作区已切换')} ${p.dim(target)}`;
    } else {
      workspaceLine = `${p.yellow(`  ⚠ 原工作区已不存在：${target}`)} ${p.dim(`（工具仍指向 ${deps.currentRoot()}）`)}`;
    }
  }
  if (!restored.some(isUserVisibleText) && restored.length > 0) {
    store.pushBlock([
      deps.paint().dim(`  （该会话没有可回放的文本消息——可能被压缩投影或日志损坏截去；消息共 ${restored.length} 条）`),
    ]);
  }
  for (const m of restored) {
    if (m.role === 'user') {
      if (m.content.trimStart().startsWith('<')) continue;
      store.pushBlock([m.content], USER_GUTTER, 'user');
    } else if (m.role === 'assistant' && m.content.trim().length > 0) {
      // 与流式轮同一 markdown 渲染（bold/标题/列表/围栏），否则同一回答
      // 实时看是渲染版、/session 切回来是裸 markdown。
      store.pushBlock(renderMarkdownLite(m.content, deps.paint()), ASSISTANT_GUTTER, 'assistant');
    }
  }
  store.pushBlock([
    `${deps.paint().green('  ✓ 已切换到会话')} ${deps.paint().dim(`${path.basename(loaded.file)} · 上下文 ${restored.length} 条消息`)}`,
  ]);
  if (workspaceLine !== undefined) store.pushBlock([workspaceLine]);
  deps.render();
}
