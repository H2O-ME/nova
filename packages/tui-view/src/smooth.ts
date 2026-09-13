/**
 * Stream smoothing (codex-style typewriter): SSE deltas arrive in network
 * bursts, and dumping each burst straight into the visible block makes the
 * output lurch. The smoother holds the pending tail and meters it out in
 * small code-point-safe chunks on a steady tick — the text always flows,
 * even when the network does not.
 */
export class StreamSmoother {
  private pending = '';

  /** Queue more stream text for gradual reveal. */
  push(text: string): void {
    if (text.length > 0) this.pending += text;
  }

  /** Characters awaiting reveal. */
  get length(): number {
    return this.pending.length;
  }

  /**
   * Reveal the next chunk: at least `minChars` per tick (so a slow trickle
   * still reads as typing) and backlogged enough to drain the queue in
   * ~`catchUpTicks` ticks (so a burst never lags far behind). Never splits a
   * surrogate pair — a split take backs off one UTF-16 unit.
   */
  take(minChars: number, catchUpTicks: number): string {
    if (this.pending.length === 0) return '';
    let take = Math.max(minChars, Math.ceil(this.pending.length / Math.max(1, catchUpTicks)));
    if (take >= this.pending.length) take = this.pending.length;
    if (take > 0) {
      const prev = this.pending.charCodeAt(take - 1);
      const next = take < this.pending.length ? this.pending.charCodeAt(take) : 0;
      if (prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) take -= 1;
    }
    if (take <= 0) return '';
    const chunk = this.pending.slice(0, take);
    this.pending = this.pending.slice(take);
    return chunk;
  }

  /** Reveal everything at once (turn end / flush paths). */
  flush(): string {
    const chunk = this.pending;
    this.pending = '';
    return chunk;
  }

  /** Drop pending text without revealing (abort / retry paths). */
  clear(): void {
    this.pending = '';
  }
}
