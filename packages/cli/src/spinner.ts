/**
 * Headless progress spinner (REPL): single-line `\r` rewrite. Control codes
 * route through the Paint's open-state primitives so a non-color stream
 * (NO_COLOR / piped) stays silent instead of leaking raw escape sequences
 * into captured output. M11 批1c：constants 收进 cli 本地 lines 层。
 */

import { SPINNER_FRAMES, SPINNER_TICK_MS, SPINNER_VERBS, type Paint } from './lines.js';

export class Spinner {
  private timer: NodeJS.Timeout | undefined;
  private startedAt = 0;
  private frame = 0;

  constructor(
    private readonly enabled: boolean,
    private readonly paint: Paint,
  ) {}

  start(): void {
    if (!this.enabled) return;
    this.stop();
    this.startedAt = Date.now();
    this.timer = setInterval(() => {
      this.frame += 1;
      const frame = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length];
      const verb = SPINNER_VERBS[Math.floor(this.frame / SPINNER_FRAMES.length) % SPINNER_VERBS.length] ?? '思考中';
      const secs = ((Date.now() - this.startedAt) / 1000).toFixed(1);
      process.stdout.write(`\r${this.paint.dim(`${frame} ${verb}… ${secs}s`)}${this.paint.clearRight()}`);
    }, SPINNER_TICK_MS);
  }

  stop(): void {
    if (this.timer === undefined) return;
    clearInterval(this.timer);
    this.timer = undefined;
    process.stdout.write(this.paint.clearLine());
  }
}
