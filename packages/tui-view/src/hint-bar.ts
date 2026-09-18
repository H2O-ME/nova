/**
 * 底部快捷键条（Grok shortcuts_bar 的移植）。
 *
 * 分工是这套设计语言里最关键的一条：**占位符只说"在这里输入"，键位归键位条**。
 * Nova 原先把 `Esc 中断 · Ctrl+C×2 退出` 塞进开屏面板、又塞进 composer 占位行，
 * 结果哪儿都在说、哪儿都不像设计。现在键位集中到屏幕最后一行，随状态换内容，
 * 超宽时按 Grok 的顺序整条从尾部丢（不折行、不加省略号）。
 */

import { HINT_SEP, segRow } from './layout.js';
import type { Palette } from './palette.js';

export interface HintItem {
  key: string;
  label: string;
}

export interface HintState {
  /** 哪个选择面板占用了键盘。 */
  picker: 'command' | 'model' | 'session' | 'approval' | undefined;
  modeSelect: boolean;
  streaming: boolean;
  queue: number;
  /** Tab 此刻真能切执行模式吗——不能就别把键位印在屏幕上骗人。 */
  tabMode: boolean;
}

/** 键位表：状态 → 从左到右要看到的几条。顺序即优先级（尾部先丢）。 */
export function hintItems(v: HintState): HintItem[] {
  if (v.picker === 'approval') {
    return [
      { key: '↑↓', label: '选择' },
      { key: '1-9', label: '选项' },
      { key: '⏎', label: '确认' },
      { key: 'Esc', label: '拒绝' },
    ];
  }
  if (v.picker === 'command') {
    return [
      { key: '↑↓', label: '选择' },
      { key: 'Tab', label: '补全' },
      { key: '⏎', label: '执行' },
      { key: 'Esc', label: '关闭' },
    ];
  }
  if (v.picker === 'model' || v.picker === 'session') {
    return [
      { key: '↑↓', label: '选择' },
      { key: '1-9', label: '快选' },
      { key: '⏎', label: '切换' },
      { key: 'Esc', label: '取消' },
    ];
  }
  if (v.modeSelect) {
    return [
      { key: '↑↓', label: '选模式' },
      { key: '⏎', label: '确认' },
      { key: 'Esc', label: '保持' },
      { key: '输入', label: '直接开始' },
    ];
  }
  if (v.streaming) {
    const items: HintItem[] = [
      { key: 'Esc', label: '中断' },
      { key: '⏎', label: v.queue > 0 ? '继续排队' : '排队' },
    ];
    if (v.queue > 0) items.push({ key: '队列', label: `${v.queue}` });
    items.push({ key: 'Ctrl+C', label: '退出' });
    return items;
  }
  return [
    { key: '⏎', label: '发送' },
    { key: '/', label: '命令' },
    { key: '↑↓', label: '历史' },
    ...(v.tabMode ? [{ key: 'Tab', label: '切模式' }] : []),
    { key: 'Ctrl+C', label: '退出' },
  ];
}

/** 一行键位：`键` 加粗、`:动作` 暗色（Grok key=text_secondary+BOLD、label=muted），条目间 5 列 `  │  `。 */
export function hintBar(p: Palette, items: readonly HintItem[], cols: number): string {
  return segRow(
    items.map((item) => ({
      text: `${item.key}:${item.label}`,
      style: (raw: string): string => {
        const at = raw.indexOf(':');
        return `${p.bold(raw.slice(0, at))}${p.dim(raw.slice(at))}`;
      },
    })),
    HINT_SEP,
    cols,
  );
}
