/**
 * Headless progress spinner (REPL/exec): single-line `\r` rewrite. The TUI
 * shell has its own frame-driven animation; this class is only for the
 * line-oriented runners.
 */

import { SPINNER_FRAMES, SPINNER_TICK_MS, SPINNER_VERBS } from '@nova-agent/tui-view';

/** codex-style status text: `思考中 (3.2s · Esc 中断)`. */
export function statusIndicator(streaming: boolean, elapsedMs: number, verbIndex: number): string {
  if (!streaming) return '输入';
  const verb = SPINNER_VERBS[Math.floor(verbIndex / SPINNER_FRAMES.length) % SPINNER_VERBS.length] ?? '思考中';
  const secs = (elapsedMs / 1000).toFixed(1);
  return `${verb} (${secs}s · Esc 中断)`;
}

export class Spinner {
  private timer: NodeJS.Timeout | undefined;
  private startedAt = 0;
  private frame = 0;

  constructor(private readonly enabled: boolean) {}

  start(): void {
    if (!this.enabled) return;
    this.stop();
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      this.frame += 1;
      const frame = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
      const verb = SPINNER_VERBS[Math.floor(this.frame / SPINNER_FRAMES.length) % SPINNER_VERBS.length] ?? '思考中';
      const secs = ((Date.now() - this.startedAt) / 1000).toFixed(1);
      process.stdout.write(`\r\x1b[2m${frame} ${verb}… ${secs}s\x1b[0m\x1b[0K`);
    }, SPINNER_TICK_MS);
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    process.stdout.write('\r\x1b[0K');
  }
}
