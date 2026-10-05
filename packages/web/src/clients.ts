/**
 * Who is attached, and how text reaches them.
 *
 * Split from `controller.ts` because it answers a different question: the
 * controller turns frames into kernel calls, while this owns the SOCKET
 * bookkeeping — the attached set, the baseline a fresh socket is sent, and the
 * fanout loop. Keeping the two apart means the fanout can be reasoned about (and
 * changed) without reading the routing table, and the controller no longer holds
 * a mutable `Set` that every method could reach into.
 *
 * Deliberately NOT owning the frame text: callers pass an already-serialized
 * string, because the encoding decision belongs to whoever knows the frame's
 * type. This class only decides who receives it.
 */
import type { WsConnection } from './ws.js';

export class ClientFanout {
  private readonly clients = new Set<WsConnection>();

  /** How many sockets are attached (the last-one-out convergence check). */
  get count(): number {
    return this.clients.size;
  }

  /**
   * Register a freshly-upgraded socket and send it the baseline.
   * @param client - the new connection.
   * @param baseline - the `ready` frame text (the client rebuilds from it).
   */
  attach(client: WsConnection, baseline: string): void {
    this.clients.add(client);
    client.send(baseline);
  }

  /**
   * Forget a socket. Idempotent, so a socket closed by both sides is harmless.
   * @param client - the connection to drop.
   */
  detach(client: WsConnection): void {
    this.clients.delete(client);
  }

  /**
   * Send one already-serialized frame to every attached client.
   *
   * A snapshot of the set is iterated, so a listener that attaches or detaches
   * during the loop cannot change what this pass delivers (and cannot throw the
   * "Set modified during iteration" error).
   * @param text - the serialized frame.
   */
  broadcast(text: string): void {
    for (const client of Array.from(this.clients)) client.send(text);
  }

  /** Close and forget every client (process teardown). */
  close(): void {
    for (const client of this.clients) client.close();
    this.clients.clear();
  }
}
