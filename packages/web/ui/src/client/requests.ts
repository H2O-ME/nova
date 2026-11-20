/**
 * 请求-响应枢纽：把「发一帧、等同类回帧」收敛成一处。
 *
 * 管道删掉 HTTP 之后，原来四个 `fetch()` 调用点（图片上传/回读、dashboard、
 * context-window）以及插件的 bundle 拉取都改走客户端帧。这些回帧没有统一的
 * 关联 id 字段，所以匹配规则按回帧的性质分两档：
 *
 *  - 回帧自带请求里的键（`image_data` 回带图片内容 id）→ 提供 `match` 精确
 *    匹配，同键并发互不错配；
 *  - 回帧没有关联字段（`image_uploaded` / `dashboard` / `context_window` /
 *    `plugin_asset`）→ 不提供 `match`，按回帧类型排队：同一时刻该类型只有
 *    一个请求在飞，回帧归属无歧义。这些都是本地 IPC，排队延迟可以忽略。
 *
 * 本模块不持有连接：`model.ts` 在连接建立时把发送路径注册进来，进站帧先经
 * `deliverServerFrame` 认领、认领不走的才进 reducer。因此回帧永远不产生
 * reducer 动作，不污染界面状态。
 */

import type { ClientFrame, ServerFrame } from '../types.js';

/** 发送路径的形状（`Connection.send` 的自然签名）。 */
type FrameSender = (frame: unknown) => boolean;

let frameSender: FrameSender | undefined;

/**
 * 注册当前连接的发送路径（model 创建时调用）。同一时刻只有一个活跃连接，
 * 新注册直接覆盖旧的——StrictMode 先卸旧再装新，不会交错。
 */
export function setFrameSender(send: FrameSender): void {
  frameSender = send;
}

/** 注销发送路径；只有注册者自己（同一引用）才能真的清掉。 */
export function clearFrameSender(send: FrameSender): void {
  if (frameSender === send) frameSender = undefined;
}

/** 一次在飞的请求。 */
interface Pending {
  match: (frame: unknown) => boolean;
  settle: (frame: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** 按回帧类型索引的在飞请求；无 `match` 的类型由排队保证至多一个。 */
const pending = new Map<string, Pending[]>();

/** 每个回帧类型的串行化链；有 `match` 的请求绕开它。 */
const chains = new Map<string, Promise<unknown>>();

/** 等待上限。这些都是本地 IPC，超时只在宿主真的卡死时兜底。 */
const DEFAULT_TIMEOUT_MS = 15_000;

/** 摘除一个 pending 并落定。唯一的收尾路径：超时、发送失败、回帧命中都走它。 */
function settleEntry(replyType: string, entry: Pending, frame: unknown): void {
  const queue = pending.get(replyType);
  if (queue !== undefined) {
    const index = queue.indexOf(entry);
    if (index !== -1) queue.splice(index, 1);
  }
  clearTimeout(entry.timer);
  entry.settle(frame);
}

/**
 * 发一帧并等待匹配的回帧。
 *
 * @param frame - 要发送的客户端帧。
 * @param replyType - 期待回帧的 `type`；也是排队键。
 * @param options.match - 精确匹配谓词（例如按回帧自带的 id）；给了就允许同
 *   类型并发。谓词必须只认可「确实属于这次请求」的回帧。
 * @param options.timeoutMs - 等待上限，到点 resolve `undefined`。
 * @returns 匹配的回帧；连接不存在、发送失败、超时都 resolve `undefined`。
 */
export function requestFrame<K extends ServerFrame['type']>(
  frame: ClientFrame,
  replyType: K,
  options: { match?: (frame: Extract<ServerFrame, { type: K }>) => boolean; timeoutMs?: number } = {},
): Promise<Extract<ServerFrame, { type: K }> | undefined> {
  // 注册 pending 必须先于发送：回帧可能在 send 返回之前就到。
  const task = (): Promise<Extract<ServerFrame, { type: K }> | undefined> => new Promise((resolve) => {
    const send = frameSender;
    if (send === undefined) {
      resolve(undefined);
      return;
    }
    const replyTypeOf = (candidate: unknown): string | undefined => {
      if (typeof candidate !== 'object' || candidate === null) return undefined;
      const type = (candidate as { type?: unknown }).type;
      return typeof type === 'string' ? type : undefined;
    };
    // pending 表以 unknown 为界（进站帧未校验）；调用方的窄类型谓词在这里
    // 收窄回它的帧形。
    const entry: Pending = {
      match: (candidate): boolean =>
        options.match !== undefined
          ? options.match(candidate as Extract<ServerFrame, { type: K }>)
          : replyTypeOf(candidate) === replyType,
      settle: (frame): void => resolve(frame as Extract<ServerFrame, { type: K }> | undefined),
      timer: setTimeout(() => settleEntry(replyType, entry, undefined), options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    };
    const queue = pending.get(replyType);
    if (queue === undefined) pending.set(replyType, [entry]);
    else queue.push(entry);
    if (!send(frame)) settleEntry(replyType, entry, undefined);
  });

  if (options.match !== undefined) return task();

  // 无 match：排队串行。前一个任务无论成败都不阻塞后一个（`.then(task, task)`），
  // 链本身吞掉拒绝，避免变成永久毒链。
  const prior = chains.get(replyType) ?? Promise.resolve();
  const next = prior.then(task, task);
  chains.set(replyType, next.catch(() => undefined));
  return next;
}

/**
 * 进站帧先经这里认领。命中在飞请求时落定它并返回 true（该帧不再进 reducer）；
 * 没有命中的帧原样放行——包括迟到的回帧（pending 已超时摘除），它们进了
 * reducer 也只是落在 null mapper 上，无害。
 */
export function deliverServerFrame(frame: unknown): boolean {
  if (typeof frame !== 'object' || frame === null) return false;
  const type = (frame as { type?: unknown }).type;
  if (typeof type !== 'string') return false;
  const queue = pending.get(type);
  if (queue === undefined) return false;
  const index = queue.findIndex((entry) => entry.match(frame));
  if (index === -1) return false;
  const entry = queue[index]!;
  settleEntry(type, entry, frame);
  return true;
}

/**
 * 放弃全部在飞请求（断线时调用）：让等待者立刻拿到 `undefined` 降级，而
 * 不是干等到超时。排队链一并清空——重连后的新请求不应排在死链后面。
 */
export function dropPendingRequests(): void {
  // 先摘索引再落定：settleEntry 会在迭代中途 splice，直接遍历原结构会跳项。
  const queues = [...pending.values()];
  pending.clear();
  for (const queue of queues) {
    for (const entry of queue) {
      clearTimeout(entry.timer);
      entry.settle(undefined);
    }
  }
  chains.clear();
}
