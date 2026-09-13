import { describe, expect, it } from 'vitest';
import { plainPalette, palette, resolvePalette } from '../src/index.js';

/**
 * 主题解析单源。核心红线：dark（默认）必须解析到原 palette **同一实例**
 * ——默认观感与引入主题层之前逐字节一致；plain 在任何 caps 下都是无色。
 */
describe('resolvePalette', () => {
  it('dark (default) resolves to the original palette instance', () => {
    expect(resolvePalette(undefined, { color: true, truecolor: false })).toBe(palette);
    expect(resolvePalette('dark', { color: true, truecolor: true })).toBe(palette);
  });

  it('caps.color=false forces plain regardless of the requested theme', () => {
    expect(resolvePalette('light', { color: false, truecolor: false })).toBe(plainPalette);
    expect(resolvePalette('dark', { color: false, truecolor: false })).toBe(plainPalette);
  });

  it('light with truecolor emits 24-bit SGR values', () => {
    const p = resolvePalette('light', { color: true, truecolor: true });
    expect(p.green('x')).toBe('\x1b[38;2;0;135;0mx\x1b[0m');
    expect(p.red('x')).toBe('\x1b[38;2;175;0;0mx\x1b[0m');
  });

  it('light without truecolor falls back to 16-color approximations', () => {
    const p = resolvePalette('light', { color: true, truecolor: false });
    expect(p.green('x')).toBe('\x1b[32mx\x1b[0m');
    expect(p.bold('x')).toBe('\x1b[1mx\x1b[0m');
  });

  it('plain resolves colorless even on a truecolor terminal', () => {
    expect(resolvePalette('plain', { color: true, truecolor: true })).toBe(plainPalette);
  });

  it('unknown names fall back to dark (config schema blocks typos earlier)', () => {
    expect(resolvePalette('nord', { color: true, truecolor: false })).toBe(palette);
  });
});
