/**
 * Follow the kernel's CURRENT session, re-binding on every replacement.
 *
 * Why this is its own object rather than two fields on the controller: the
 * subscription must move whenever the kernel swaps its session, and the kernel
 * does that on its OWN (a `setWorkspace` on a still-blank session mints a fresh
 * one so its context names the new workspace). A subscription pinned to the
 * session bound at boot goes silent at that moment — the transcript stops
 * updating while the kernel keeps working. Owning the "bound session" and its
 * unsubscribe together is what makes "am I following?" a single question instead
 * of two fields that can disagree.
 */
import type { AgentSession, KernelEvent } from '@nova-agent/core';

export class SessionFollow {
  private bound: AgentSession | undefined;
  private unsubscribe: (() => void) | undefined;

  /**
   * Point the subscription at the kernel's current session, if it moved.
   *
   * Idempotent: a caller says "make sure I am following" rather than tracking
   * whether something replaced the session.
   * @param current - the session the kernel reports now.
   * @param onEvent - receives every event of the followed session.
   */
  follow(current: AgentSession, onEvent: (event: KernelEvent) => void): void {
    if (this.bound === current) return;
    this.unsubscribe?.();
    this.bound = current;
    this.unsubscribe = current.subscribe(onEvent);
  }

  /**
   * Stop following and forget the binding.
   *
   * Called before disposing a session being abandoned: its own terminal events
   * must not be broadcast as if they belonged to the replacement.
   */
  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.bound = undefined;
  }
}
