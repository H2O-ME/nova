/**
 * Key routing chain: approval modal → model picker → session picker →
 * global keys → composer/popup. Each layer consumes its keys and returns
 * true; unrecognized keys fall through. Modal layers are mutually exclusive
 * with the composer (an open popup swallows everything).
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
  if (keyClick(env, k)) return;
  if (keyApprovalModal(env, k)) return;
  if (keyModelPicker(env, k)) return;
  if (keySessionPicker(env, k)) return;
  if (keyGlobal(env, k)) return;
  keyComposerAndPopup(env, k);
  env.scheduleRender();
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
          toggleReasoningBlock(env, seg.block);
          break;
        }
      }
    }
  }
  return true;
}

function toggleReasoningBlock(env: KeyEnv, block: Block): void {
  if (block.detail === undefined) return;
  const expanded = block.expanded !== true;
  block.expanded = expanded;
  env.store.replaceBlock(
    block,
    expanded
      ? [summaryRow(env.paint, block.detail.secs, true), ...reasoningDetailRows(env.paint, block.detail.lines, env.cols())]
      : [summaryRow(env.paint, block.detail.secs, false)],
  );
}

import { APPROVAL_CODES } from './store.js';
import { reasoningDetailRows, summaryRow } from '@nova-agent/tui-view';

/** Approval modal swallows everything (arrows + Enter, y/a/n + 1/2/3). */
function keyApprovalModal(env: KeyEnv, k: Key): boolean {
  const { store } = env;
  if (store.approval === undefined) return false;
  const resolve = (answer: 'allow' | 'deny' | 'always'): void => {
    store.approval?.resolve(answer);
    store.approval = undefined;
    store.approvalPreview = undefined;
  };
  if (k.type === 'ctrl+c') {
    resolve('deny');
    env.abortLast();
    env.scheduleRender();
    return true;
  }
  if (k.type === 'up') store.approvalIndex = Math.max(0, store.approvalIndex - 1);
  else if (k.type === 'down') store.approvalIndex = Math.min(APPROVAL_CODES.length - 1, store.approvalIndex + 1);
  else if (k.type === 'enter') {
    resolve(APPROVAL_CODES[store.approvalIndex] ?? 'deny');
  } else if (k.type === 'char') {
    if (k.ch === 'y' || k.ch === 'Y') resolve('allow');
    else if (k.ch === 'a' || k.ch === 'A') resolve('always');
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

/** Global keys: Ctrl+C triple-duty, Ctrl+D exit, streaming Esc abort. */
function keyGlobal(env: KeyEnv, k: Key): boolean {
  const { store } = env;
  if (k.type === 'ctrl+c') {
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
    case 'home':
      store.cursorPos = 0;
      break;
    case 'end':
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


