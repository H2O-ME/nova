/**
 * Key routing chain: hover motion → click → approval modal → model picker →
 * session picker → global keys → composer/popup. Each layer consumes its keys
 * and returns true; unrecognized keys fall through. Modal layers are
 * mutually exclusive with the composer (an open popup swallows everything).
 */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Key } from '@nova-agent/tui';
import {
  composerWrapBudget,
  cursorAfterVerticalMove,
  DOUBLE_CTRLC_MS,
  MODEL_PICKER_WINDOW,
  PASTE_MAX_CHARS,
  SESSION_PICKER_WINDOW,
  type Palette,
} from '@nova-agent/tui-view';
import type { Block, TuiStore } from './store.js';

export interface KeyEnv {
  store: TuiStore;
  paint: Palette;
  cols: () => number;
  rows: () => number;
  abortLast: () => void;
  /** Cancel a running compaction (the summarizer request has no other abort path). */
  abortCompact: () => void;
  /** Startup mode selector: move highlight / confirm highlighted (or a specific 0-based row). */
  modeSelectMove: (delta: number) => void;
  modeSelectConfirm: (index?: number) => void;
  modeSelectDismiss: () => void;
  exitApp: () => void;
  scheduleRender: () => void;
  preemptRender: () => void;
  submit: () => void;
  toggleCodeMode: () => void;
  /** Mode switch gate: only before the conversation starts (seed fragment only). */
  canSwitchMode: () => boolean;
  /** Visible feedback when Tab is pressed after the conversation has started. */
  noteModeSwitchBlocked: () => void;
  switchModel: (model: string) => void;
  switchSessionFile: (file: string) => void;
  currentModel: () => string;
  currentSessionFile: () => string;
  refreshModelMeta: () => void;
  popupMatches: () => { name: string }[];
  totalWrappedLines: () => number;
  notice: (lines: string[]) => void;
}

export function handleKey(env: KeyEnv, k: Key): void {
  if (keyGaugeHover(env, k)) return;
  if (keyClick(env, k)) return;
  if (keyApprovalModal(env, k)) return;
  if (keyModeSelect(env, k)) return;
  if (keyModelPicker(env, k)) return;
  if (keySessionPicker(env, k)) return;
  if (keyGlobal(env, k)) return;
  keyComposerAndPopup(env, k);
  env.scheduleRender();
}

/**
 * Startup mode selector (transcript block above the composer): ↑↓/wheel move,
 * Enter confirms the highlighted row, Esc keeps the current mode. Everything
 * else falls through to the composer — and Enter with a non-empty composer
 * falls through too (sending the message matters more than picking a mode;
 * the selector collapses on submit either way).
 */
function keyModeSelect(env: KeyEnv, k: Key): boolean {
  const { store } = env;
  if (store.modeSelect === undefined) return false;
  switch (k.type) {
    case 'up':
    case 'wheelup':
      env.modeSelectMove(-1);
      env.scheduleRender();
      return true;
    case 'down':
    case 'wheeldown':
      env.modeSelectMove(1);
      env.scheduleRender();
      return true;
    case 'enter':
      if (store.input.length > 0) {
        env.modeSelectDismiss();
        return false; // the typed message wins: collapse and submit it
      }
      env.modeSelectConfirm();
      env.scheduleRender();
      return true;
    case 'esc':
      env.modeSelectDismiss();
      env.scheduleRender();
      return true;
    default:
      return false; // typing starts the session immediately
  }
}

/** Hover motion (M10 组件1): always consumed; flips the gauge morph only on
 *  zone edges so a moving mouse never re-renders frames for nothing. */
function keyGaugeHover(env: KeyEnv, k: Key): boolean {
  if (k.type !== 'mousemove') return false;
  const { store } = env;
  const zone = store.statusZone;
  const over = zone !== undefined && k.y === zone.y && k.x <= zone.gaugeEnd;
  if (store.gaugeHover !== over) {
    store.gaugeHover = over;
    env.scheduleRender();
  }
  return true;
}

/** Left click: toggle an expandable reasoning summary, else swallow. */
function keyClick(env: KeyEnv, k: Key): boolean {
  if (k.type !== 'click') return false;
  const { store } = env;
  if (store.approval !== undefined || store.modelPicker !== undefined || store.sessionPicker !== undefined) {
    return true;
  }
  const map = store.frameMap;
  if (map !== undefined) {
    const row = k.y - 1;
    if (row >= 0 && row < map.historyRows) {
      const flatIdx = map.sliceStart + row;
      for (const seg of map.rows) {
        if (flatIdx >= seg.start && flatIdx < seg.start + seg.count) {
          toggleDetailBlock(env, seg.block);
          break;
        }
      }
    }
  }
  return true;
}

/** Click on an expandable block: detail (subagent/reasoning) toggles; tool
 * output cycles the tri-state fold Collapsed → Truncated → Expanded. */
function toggleDetailBlock(env: KeyEnv, block: Block): void {
  if (block.detail !== undefined) {
    const expanded = block.expanded !== true;
    block.expanded = expanded;
    // `base` is the collapsed truth (subagent live/done row); the reasoning
    // fold header regenerates its summary row from secs with the current
    // expanded state, so the ▸/▾ affordance flips on click.
    const base = block.detail.base ?? [summaryRow(env.paint, block.detail.secs, expanded)];
    env.store.replaceBlock(block, expanded ? [...base, ...block.detail.lines] : base);
    return;
  }
  const fold = block.fold;
  if (fold === undefined) return;
  // 行源在 toolResult 时一次算全（preview/full 已含样式与行计数），点击纯拼接。
  fold.state = fold.state === 0 ? 1 : fold.state === 1 ? 2 : 0;
  const body = fold.state === 0 ? [] : fold.state === 1 ? fold.preview : fold.full;
  env.store.replaceBlock(block, [...fold.base, ...body]);
}

import { APPROVAL_CODES } from './store.js';
import type { AskAnswer, AskResult } from '@nova-agent/plugins';
import { summaryRow } from '@nova-agent/tui-view';

/** Approval modal swallows everything (arrows + Enter, y/a/n + 1/2/3; ←/→ tunes the always scope). */
function keyApprovalModal(env: KeyEnv, k: Key): boolean {
  const { store } = env;
  if (store.approval === undefined) return false;
  const resolve = (answer: AskResult): void => {
    store.approval?.resolve(answer);
    store.approval = undefined;
    store.approvalPreview = undefined;
  };
  // 组件6：词数 >1 才是显式范围授权；1 走引擎默认（程序前缀）。
  const scopeGrant = (code: AskAnswer | 'always'): AskResult =>
    code === 'always' && store.approvalScope > 1 ? { answer: 'always', scopeWords: store.approvalScope } : code;
  if (k.type === 'ctrl+c') {
    resolve('deny');
    env.abortLast();
    env.scheduleRender();
    return true;
  }
  // 组件6：←/→ 属于范围调节，先行截断，不进选择链。
  if (k.type === 'left' || k.type === 'right') {
    scopeStep(store, k);
    env.scheduleRender();
    return true;
  }
  if (k.type === 'up') store.approvalIndex = Math.max(0, store.approvalIndex - 1);
  else if (k.type === 'down') store.approvalIndex = Math.min(APPROVAL_CODES.length - 1, store.approvalIndex + 1);
  else if (k.type === 'enter') {
    resolve(scopeGrant(APPROVAL_CODES[store.approvalIndex] ?? 'deny'));
  } else if (k.type === 'char') {
    if (k.ch === 'y' || k.ch === 'Y') resolve('allow');
    else if (k.ch === 'a' || k.ch === 'A') resolve(scopeGrant('always'));
    else if (k.ch === 'n' || k.ch === 'N') resolve('deny');
    else if (k.ch === '1') store.approvalIndex = 0;
    else if (k.ch === '2') store.approvalIndex = 1;
    else if (k.ch === '3') store.approvalIndex = 2;
  } else if (k.type === 'esc') {
    resolve('deny');
  }
  env.scheduleRender();
  return true;
}

/** 组件6：「总是允许」行上 ←/→ 挪授权词数，钳制在 [1, 命令词数]；其余行不动。 */
function scopeStep(store: TuiStore, k: Key): void {
  if (store.approvalIndex !== 1) return;
  const total = store.approvalScopeWords().length;
  if (total <= 1) return;
  store.approvalScope = k.type === 'right' ? Math.min(total, store.approvalScope + 1) : Math.max(1, store.approvalScope - 1);
}

/** Model picker (↑↓/pagescroll · Enter switch · Esc cancel). */
function keyModelPicker(env: KeyEnv, k: Key): boolean {
  const { store } = env;
  if (store.modelPicker === undefined) return false;
  const picker = store.modelPicker;
  const winSize = Math.min(MODEL_PICKER_WINDOW, picker.models.length);
  if (k.type === 'ctrl+c' || k.type === 'esc') {
    store.modelPicker = undefined;
  } else if (k.type === 'up') {
    picker.index = Math.max(0, picker.index - 1);
  } else if (k.type === 'down') {
    picker.index = Math.min(picker.models.length - 1, picker.index + 1);
  } else if (k.type === 'pageup') {
    picker.index = Math.max(0, picker.index - winSize);
  } else if (k.type === 'pagedown') {
    picker.index = Math.min(picker.models.length - 1, picker.index + winSize);
  } else if (k.type === 'wheelup') {
    picker.index = Math.max(0, picker.index - 1);
  } else if (k.type === 'wheeldown') {
    picker.index = Math.min(picker.models.length - 1, picker.index + 1);
  } else if (k.type === 'enter') {
    const model = picker.models[picker.index];
    store.modelPicker = undefined;
    if (model !== undefined && model !== env.currentModel()) {
      env.switchModel(model);
    } else if (model !== undefined) {
      env.notice([`  已是当前模型：${model}`]);
    }
  } else {
    return true;
  }
  env.scheduleRender();
  return true;
}

/** Session picker (same semantics; Enter restores the session). */
function keySessionPicker(env: KeyEnv, k: Key): boolean {
  const { store } = env;
  if (store.sessionPicker === undefined) return false;
  const picker = store.sessionPicker;
  const winSize = Math.min(SESSION_PICKER_WINDOW, picker.entries.length);
  if (k.type === 'ctrl+c' || k.type === 'esc') {
    store.sessionPicker = undefined;
  } else if (k.type === 'up' || k.type === 'wheelup') {
    picker.index = Math.max(0, picker.index - 1);
  } else if (k.type === 'down' || k.type === 'wheeldown') {
    picker.index = Math.min(picker.entries.length - 1, picker.index + 1);
  } else if (k.type === 'pageup') {
    picker.index = Math.max(0, picker.index - winSize);
  } else if (k.type === 'pagedown') {
    picker.index = Math.min(picker.entries.length - 1, picker.index + winSize);
  } else if (k.type === 'enter') {
    const entry = picker.entries[picker.index];
    store.sessionPicker = undefined;
    if (entry !== undefined && entry.file !== env.currentSessionFile()) {
      env.switchSessionFile(entry.file);
    } else if (entry !== undefined) {
      env.notice([`  已是当前会话`]);
    }
  } else {
    return true;
  }
  env.scheduleRender();
  return true;
}

/** Global keys: Ctrl+C triple-duty (compact abort first), Ctrl+D exit, Esc aborts streaming/compaction. */
function keyGlobal(env: KeyEnv, k: Key): boolean {
  const { store } = env;
  if (k.type === 'ctrl+c') {
    if (store.compactRunning) {
      env.abortCompact();
      env.scheduleRender();
      return true;
    }
    if (store.streaming) {
      store.interruptAt = Date.now();
      env.abortLast();
      env.scheduleRender();
      return true;
    }
    if (store.input.length > 0) {
      store.input = '';
      store.cursorPos = 0;
      env.scheduleRender();
      return true;
    }
    const now = Date.now();
    if (now - store.lastCtrlC < DOUBLE_CTRLC_MS) {
      env.exitApp();
      return true;
    }
    store.lastCtrlC = now;
    env.scheduleRender();
    return true;
  }
  if (k.type === 'ctrl+d') {
    if (!store.streaming) env.exitApp();
    return true;
  }
  if (k.type === 'esc' && store.compactRunning) {
    env.abortCompact();
    env.scheduleRender();
    return true;
  }
  if (k.type === 'esc' && store.streaming) {
    store.interruptAt = Date.now();
    env.abortLast();
    env.scheduleRender();
    return true;
  }
  return false;
}

/** Composer editing, history, scrolling, command palette nav/complete/run. */
function keyComposerAndPopup(env: KeyEnv, k: Key): void {
  const { store } = env;
  const popupMatches = env.popupMatches();

  switch (k.type) {
    case 'enter': {
      if (popupMatches.length > 0) {
        const selected = popupMatches[Math.min(store.popupIndex, popupMatches.length - 1)];
        if (selected !== undefined) {
          store.input = selected.name;
          store.cursorPos = store.input.length;
          env.submit();
        }
        break;
      }
      env.submit();
      break;
    }
    case 'newline': {
      store.input = store.input.slice(0, store.cursorPos) + '\n' + store.input.slice(store.cursorPos);
      store.cursorPos += 1;
      store.popupDismissed = false;
      break;
    }
    case 'tab': {
      if (popupMatches.length > 0) {
        const selected = popupMatches[Math.min(store.popupIndex, popupMatches.length - 1)];
        if (selected !== undefined) {
          store.input = `${selected.name} `;
          store.cursorPos = store.input.length;
        }
      } else if (env.canSwitchMode()) {
        env.toggleCodeMode();
      } else {
        env.noteModeSwitchBlocked();
      }
      break;
    }
    case 'esc':
      store.popupDismissed = true;
      store.popupIndex = 0;
      break;
    case 'up': {
      if (popupMatches.length > 0) {
        store.popupIndex = Math.max(0, store.popupIndex - 1);
        break;
      }
      if (store.input.includes('\n')) {
        store.cursorPos = cursorAfterVerticalMove(store.input, store.cursorPos, composerWrapBudget(env.cols()), -1);
        break;
      }
      if (store.historyIdx === -1) {
        store.historyDraft = store.input;
        store.historyIdx = store.historyStack.length - 1;
      } else if (store.historyIdx > 0) {
        store.historyIdx -= 1;
      }
      if (store.historyIdx >= 0) {
        store.input = store.historyStack[store.historyIdx] ?? '';
        store.cursorPos = store.input.length;
      }
      break;
    }
    case 'down': {
      if (popupMatches.length > 0) {
        store.popupIndex = Math.min(popupMatches.length - 1, store.popupIndex + 1);
        break;
      }
      if (store.input.includes('\n')) {
        store.cursorPos = cursorAfterVerticalMove(store.input, store.cursorPos, composerWrapBudget(env.cols()), 1);
        break;
      }
      if (store.historyIdx >= 0) {
        store.historyIdx += 1;
        if (store.historyIdx >= store.historyStack.length) {
          store.historyIdx = -1;
          store.input = store.historyDraft;
        } else {
          store.input = store.historyStack[store.historyIdx] ?? '';
        }
        store.cursorPos = store.input.length;
      }
      break;
    }
    case 'pageup':
      store.scrollFromEnd = Math.min(store.scrollFromEnd + Math.max(3, env.rows() - 6), env.totalWrappedLines());
      env.scheduleRender();
      return;
    case 'pagedown':
      store.scrollFromEnd = Math.max(0, store.scrollFromEnd - Math.max(3, env.rows() - 6));
      env.scheduleRender();
      return;
    case 'wheelup':
      store.scrollFromEnd = Math.min(store.scrollFromEnd + 3, env.totalWrappedLines());
      env.preemptRender();
      return;
    case 'wheeldown':
      store.scrollFromEnd = Math.max(0, store.scrollFromEnd - 3);
      env.preemptRender();
      return;
    case 'left':
      store.cursorPos = Math.max(0, store.cursorPos - 1);
      break;
    case 'right':
      store.cursorPos = Math.min(store.input.length, store.cursorPos + 1);
      break;
    case 'ctrl+left': {
      // 词级左移：先跳过光标前的空白，再跳过连续非空白（与 ctrl+w 切词边界一致）。
      const before = store.input.slice(0, store.cursorPos);
      const cut = before.replace(/\s+$/, '').search(/\S+$/);
      store.cursorPos = cut >= 0 ? cut : 0;
      break;
    }
    case 'ctrl+right': {
      // 词级右移：越过紧邻空白与下一个词。
      const m = store.input.slice(store.cursorPos).match(/^\s*\S+/);
      store.cursorPos = store.cursorPos + (m?.[0].length ?? 0);
      break;
    }
    case 'home':
      // 光标已在行首时再按 Home = 历史区跳顶（End 对称回底）。
      if (store.cursorPos === 0) {
        store.scrollFromEnd = env.totalWrappedLines();
        env.scheduleRender();
        break;
      }
      store.cursorPos = 0;
      break;
    case 'end':
      if (store.cursorPos >= store.input.length) {
        store.scrollFromEnd = 0;
        env.scheduleRender();
        break;
      }
      store.cursorPos = store.input.length;
      break;
    case 'backspace':
      if (store.cursorPos > 0) {
        store.input = store.input.slice(0, store.cursorPos - 1) + store.input.slice(store.cursorPos);
        store.cursorPos -= 1;
      }
      store.popupDismissed = false;
      break;
    case 'delete':
      store.input = store.input.slice(0, store.cursorPos) + store.input.slice(store.cursorPos + 1);
      store.popupDismissed = false;
      break;
    case 'ctrl+u':
      store.input = store.input.slice(store.cursorPos);
      store.cursorPos = 0;
      store.popupDismissed = false;
      break;
    case 'ctrl+w': {
      const before = store.input.slice(0, store.cursorPos).trimEnd();
      const cut = before.lastIndexOf(' ');
      store.input = (cut >= 0 ? before.slice(0, cut + 1) : '') + store.input.slice(store.cursorPos);
      store.cursorPos = cut >= 0 ? cut + 1 : 0;
      store.popupDismissed = false;
      break;
    }
    case 'char':
      store.input = store.input.slice(0, store.cursorPos) + k.ch + store.input.slice(store.cursorPos);
      store.cursorPos += k.ch.length;
      store.popupDismissed = false;
      break;
    case 'paste': {
      let cleaned = k.text
        .replace(/\r\n?/g, '\n');
      // eslint-disable-next-line no-control-regex
      cleaned = cleaned.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .replaceAll('\t', '  ');

      // Image path detection: a paste that is exactly a local image file path
      // (Explorer copy / drag) is wrapped as a `![image](path)` markdown-style
      // reference. Honest scope: nova does NOT send image bytes to the model —
      // it only sees the path string and can act on it with tools (bash
      // reads/converts, run_code); a real vision channel stays on the roadmap
      // (AGENTS.md §7).
      const candidatePath = cleaned.trim().replace(/^['"]|['"]$/g, '');
      const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.svg']);
      const ext = path.extname(candidatePath).toLowerCase();
      if (IMAGE_EXTS.has(ext) && existsSync(candidatePath)) {
        try {
          const st = statSync(candidatePath);
          if (st.isFile()) {
            cleaned = `![image](${candidatePath}) `;
            env.notice([`  已插入图片路径：${path.basename(candidatePath)}（nova 暂不发送图像内容，模型仅见路径）`]);
          }
        } catch {
          // Fall back to plain paste if stat fails
        }
      }

      let truncated = false;
      if (cleaned.length > PASTE_MAX_CHARS) {
        cleaned = cleaned.slice(0, PASTE_MAX_CHARS);
        truncated = true;
      }
      if (cleaned.length > 0) {
        store.input = store.input.slice(0, store.cursorPos) + cleaned + store.input.slice(store.cursorPos);
        store.cursorPos += cleaned.length;
        store.popupDismissed = false;
      }
      if (truncated) {
        env.notice([`  （粘贴内容超过 ${PASTE_MAX_CHARS} 字符，已截断）`]);
      }
      break;
    }
  }
}


