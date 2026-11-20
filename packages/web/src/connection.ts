/**
 * The two methods a transport must provide.
 *
 * This interface outlived the WebSocket it was written for, which is the point:
 * the controller, the fanout and every frame handler need exactly "send one
 * text frame" and "you are done". Whether the bytes travel over a socket, a
 * stdio pipe or a test's array is the shell's business, and `send`/`close` is
 * the whole of that business.
 *
 * It lives in its own module so the transport files (`pipe.ts`) and the 18
 * consumers both import a contract rather than one another.
 */

/** One attached client, as the controller and the fanout see it. */
export interface WsConnection {
  /** Send one already-serialized frame. A closed connection ignores it. */
  send(text: string): void;
  /** Stop delivering to this client (the fanout then forgets it). */
  close(code?: number): void;
}

/** What a transport calls when the peer says something, or goes away. */
export interface WsHandlers {
  onMessage(text: string): void;
  onClose(): void;
}
