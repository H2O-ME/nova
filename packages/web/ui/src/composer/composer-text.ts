/**
 * The composer's copy and its pure decisions. Every string is the harness's
 * own `conversation` dictionary, simplified Chinese (`ui-conversation/src/
 * client/locales.ts`, MIT) — the reference ships a zh sheet, so our wording is
 * the reference's, verbatim, not a translation of it.
 *
 * The two decisions worth pinning are the primary seat (send vs. stop, and the
 * label that names what a click delivers) and the queue strip's shape; both are
 * derived here so a test can assert them without a DOM.
 */

/** `placeholder.default`: message, / commands, @ files. */
export const PLACEHOLDER_DEFAULT = '发消息或创建任务, / 调用指令, @ 文件或对话';
/** `placeholder.hero`: the centered empty state's wider invitation. */
export const PLACEHOLDER_HERO = '描述你想要构建的内容, / 调用指令, @ 文件或对话';
/** `placeholder.unavailable`: no session can take input. */
export const PLACEHOLDER_UNAVAILABLE = '会话不可用';
/** `input.commands`: the + control's accessible name. */
export const COMMANDS_LABEL = '添加文件或调用指令';
/** `input.send`. */
export const SEND_LABEL = '发送消息';
/** `input.send.queue`: the busy Enter lands in the kernel's queue. */
export const QUEUE_SEND_LABEL = '排队发送';
/** `input.stop`. */
export const STOP_LABEL = '停止生成';
/** `drill.hint` / `drill.aria` (`slash.menu` dictionary): the drill chevron. */
export const DRILL_HINT = '进入目录';
export const DRILL_ARIA = '进入目录';
/** `drill.key`: the Tab keycap beside the hint. */
export const DRILL_KEY = 'Tab';
/** `slash.menu`'s `loading`: the pending candidate list's accessible name. */
export const MENU_LOADING = '正在加载…';
/** `reference.crumb.root` (`reference` dictionary): the trail's first step. */
export const REFERENCE_ROOT_CRUMB = '根目录';
/** `reference.section.files`: the `@` listing's single section heading. */
export const REFERENCE_SECTION = '文件';
/** `slash.menu`'s `crumbs.aria`: the drilled listing's breadcrumb header. */
export const REFERENCE_CRUMBS_ARIA = '所在目录';

/**
 * The attachment rail's copy, verbatim from the reference's `conversation`
 * dictionary (`attachment.*`, `file.*`, `image.*`).
 */
export const ATTACHMENT_GROUP = '待发送附件';
export const ATTACHMENT_SCROLL_LEFT = '向左滚动附件';
export const ATTACHMENT_SCROLL_RIGHT = '向右滚动附件';
export const DROP_TITLE = '文件或图片拖动到此处即可添加';
export const DROP_BLOCKED = '当前无法添加文件或图片';
export const FILE_PENDING = '待发送文件';
export const FILE_UPLOADING = '上传中…';
export const FILE_UPLOAD_FAILED = '上传失败，点击重试';

/** `file.remove`: `移除文件 {name}`. */
export function fileRemoveLabel(name: string): string {
  return `移除文件 ${name}`;
}

/** `file.retry`: `重试上传 {name}`. */
export function fileRetryLabel(name: string): string {
  return `重试上传 ${name}`;
}

/**
 * The draft's placeholder: the owner prop wins, then the bar's own states.
 * @param state - the bar's live facts.
 * @returns the placeholder text.
 */
export function placeholderFor(state: { disabled: boolean; hero?: boolean; override?: string }): string {
  if (state.override !== undefined) return state.override;
  if (state.disabled) return PLACEHOLDER_UNAVAILABLE;
  return state.hero === true ? PLACEHOLDER_HERO : PLACEHOLDER_DEFAULT;
}

/**
 * Whether a draft is an ordinary message (harness `plainMessageDraft`): an
 * empty draft and a `/`-leading line are both excluded, because neither is
 * promised a plain-message delivery (a `/` line may be adjudicated as a
 * command).
 * @param draft - the raw draft.
 * @returns true when the draft is a plain message.
 */
export function plainDraft(draft: string): boolean {
  const trimmed = draft.trim();
  return trimmed !== '' && !draft.trimStart().startsWith('/');
}

/** The model seat's label: the catalog's name when the host knows one (an
 *  endpoint publishes ids, never labels), else the id, else the em-dash
 *  placeholder before the first `ready`. */
export function modelLabel(model: string): string {
  return model.length > 0 ? model : '—';
}

/** What the composer's primary (rightmost) seat is showing. */
export interface PrimarySeat {
  /** `stop` interrupts the run in flight; `send` delivers the draft. */
  kind: 'stop' | 'send';
  disabled: boolean;
  /** The accessible name, and what a click delivers right now. */
  label: string;
}

/** `file.stillUploading`: the primary refuses while a body is in flight. */
export const STILL_UPLOADING = '文件还在上传，请等待上传完成后发送';

/**
 * Whether a draft may be delivered at all, as ONE verdict for the two readers
 * that must never disagree: the primary seat's disabled state and `submit()`'s
 * own early returns. They once diverged on exactly this question — the seat was
 * fed a hard-coded `uploading: false` while `submit` checked the real
 * attachments, so an image still in flight showed an enabled 发送 button whose
 * click and Enter both silently did nothing. Both now read the same verdict
 * built from the same facts.
 *
 * Order matters and is the submit path's own: EMPTY refuses before UPLOADING
 * (an image-only prompt is legitimate, so readiness counts as content), and a
 * mixed batch (one image ready, one still uploading) refuses on UPLOADING —
 * the prompt would name a file that does not exist yet.
 */
export type SendGate =
  | { ok: true }
  | { ok: false; why: 'empty' | 'uploading' };

export function sendGate(state: { draft: string; readyImages: number; uploadingImages: number }): SendGate {
  if (state.draft.trim() === '' && state.readyImages === 0) return { ok: false, why: 'empty' };
  if (state.uploadingImages > 0) return { ok: false, why: 'uploading' };
  return { ok: true };
}

/**
 * The primary seat (harness InputBar `primaryStops` / `primaryLabel`, minus
 * the seats our kernel has no transport for: steering and continuable
 * children).
 *
 * Three rules carry the design: a running turn with an EMPTY draft turns the
 * seat into Stop — the abort control must stay reachable while the loop is in
 * flight, and an empty draft would send nothing; a draft delivered into a
 * running turn is named for what it does (the kernel queues it) rather than
 * promising an immediate send; and a draft whose attachments are still
 * uploading is REFUSED, because the prompt would name a file that does not
 * exist on disk yet (dsh `view-binding.ts:128` refuses for the same reason).
 * @param state - the bar's live facts.
 * @returns the seat's kind, enabled state, and label.
 */
export function primarySeat(
  state: { running: boolean; disabled: boolean; draft: string; uploading?: boolean },
): PrimarySeat {
  const empty = state.draft.trim() === '';
  if (state.running && empty) return { kind: 'stop', disabled: false, label: STOP_LABEL };
  // Refusing beats sending a prompt that silently omits the file: the reader
  // gets the reason as the control's own name rather than as a later failure.
  if (state.uploading === true && !empty) {
    return { kind: 'send', disabled: true, label: STILL_UPLOADING };
  }
  return {
    kind: 'send',
    disabled: state.disabled || empty,
    label: state.running && !state.disabled && plainDraft(state.draft) ? QUEUE_SEND_LABEL : SEND_LABEL,
  };
}

/**
 * `queue.count`: `{n} 条排队消息`.
 * @param count - queued prompts.
 * @returns the count header's text.
 */
export function queueCountLabel(count: number): string {
  return `${count} 条排队消息`;
}

/**
 * One queue row's single-line preview: the kernel ships the prompt's own text
 * (the harness ships a host-computed preview), so the row collapses whatever
 * whitespace the draft carried into one line for the CSS ellipsis.
 * @param text - the queued prompt.
 * @returns the preview text.
 */
export function queuePreview(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * The count header renders only above one row; a single item is its own strip
 * (its row carries the queue glyph the header would).
 * @param count - queued prompts.
 * @returns true when the header renders.
 */
export function queueHeaderVisible(count: number): boolean {
  return count > 1;
}

/**
 * A one-row strip always shows its row; a longer one collapses behind the
 * count header until the user opens it.
 * @param count - queued prompts.
 * @param collapsed - the header's own state.
 * @returns true when the list is visible.
 */
export function queueListVisible(count: number, collapsed: boolean): boolean {
  return count === 1 || !collapsed;
}

/** `image.remove`: `移除图片 {name}`. */
export function imageRemoveLabel(name: string): string {
  return `移除图片 ${name}`;
}