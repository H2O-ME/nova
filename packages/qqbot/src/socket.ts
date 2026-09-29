/**
 * 网关的 socket 工厂：默认用运行时的全局 `WebSocket` 连出去。
 *
 * 从 `runtime.ts` 拆出，因为它是另一个问题：那边讲**通道怎么装配起来**（凭据、
 * 网关、插件、启停生命周期），这里讲**拨号那一下用什么 socket**（生产走真
 * WebSocket，测试注入假的）。前者是装配，后者是传输细节。
 */
import type { SocketFactory } from './protocol.js';

/**
 * The default transport: connect a real `WebSocket` and resolve on open.
 * @param url - the gateway URL from `resolveGatewayUrl`.
 * @returns the socket handle the gateway drives.
 */
export const defaultSocketFactory: SocketFactory = async (url) => {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve(), { once: true });
    ws.addEventListener('error', () => reject(new Error('websocket open failed')), { once: true });
  });
  return {
    send: (data) => ws.send(data),
    close: () => ws.close(),
    onMessage: (cb) => ws.addEventListener('message', (ev) => cb(String((ev as MessageEvent).data))),
    onClose: (cb) => ws.addEventListener('close', () => cb(false)),
  };
};
