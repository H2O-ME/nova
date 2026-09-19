import { describe, expect, it } from 'vitest';
import { styledWidth } from '@nova-agent/tui';
import { formatElapsed, turnStatus } from '../src/index.js';
import { plainPalette } from '../src/palette.js';

const row = (over: Partial<Parameters<typeof turnStatus>[1]> = {}): string =>
  turnStatus(plainPalette, { phase: 'thinking', spinnerFrame: 0, elapsedMs: 4200, ...over });

describe('formatElapsed — Grok 的三档时长', () => {
  it('<10s 一位小数、<60s 整秒、更久 m+s+，负数钳到 0', () => {
    expect(formatElapsed(0)).toBe('0.0s');
    expect(formatElapsed(4200)).toBe('4.2s');
    expect(formatElapsed(9999)).toBe('10.0s');
    expect(formatElapsed(10_000)).toBe('10s');
    expect(formatElapsed(59_400)).toBe('59s');
    expect(formatElapsed(65_000)).toBe('1m5s');
    expect(formatElapsed(-5)).toBe('0.0s');
  });
});

describe('turnStatus 活体行', () => {
  it('阶段词随 genPhase 换，恒带转轮与耗时', () => {
    expect(row()).toContain('思考中');
    expect(row({ phase: 'writing' })).toContain('回答中');
    expect(row({ phase: 'tool' })).toContain('执行工具');
    expect(row({ phase: 'idle' })).toContain('进行中');
    expect(row()).toContain('4.2s');
    expect(styledWidth(row())).toBeLessThanOrEqual(20);
  });

  it('转轮落在标记列（与 ❯ / ✓ / ▌ 同一列），耗时位数变化只挪尾部不挪行首', () => {
    const a = row({ elapsedMs: 300 });
    const b = row({ elapsedMs: 12_400 });
    expect(a.startsWith('  ')).toBe(true);
    expect(b.startsWith('  ')).toBe(true);
    const head = (line: string): string => line.slice(0, line.indexOf('…') + 1);
    expect(head(a)).toBe(head(b));
  });
});
