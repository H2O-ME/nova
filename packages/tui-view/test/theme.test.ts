import { describe, expect, it } from 'vitest';
import { plainPalette, palette, resolvePalette } from '../src/index.js';

/**
 * 主题解析单源。红线：plain 在任何 caps 下都是无色；dark 的 **16 色档**必须仍解析到
 * 原 palette 同一实例（不支持 24-bit 的终端观感逐字节不变）。批13 起 truecolor 档
 * 换绑 GrokNight——那是这次对齐的起点，不再是"原配色原样平移"。
 */
describe('resolvePalette', () => {
  it('dark 的 16 色档仍是原 palette 同一实例，truecolor 档另起一套', () => {
    expect(resolvePalette(undefined, { color: true, truecolor: false })).toBe(palette);
    expect(resolvePalette('dark', { color: true, truecolor: false })).toBe(palette);
    expect(resolvePalette('dark', { color: true, truecolor: true })).not.toBe(palette);
  });

  it('dark truecolor 落到 GrokNight RGB（teal accent / 固定灰次要文本，不再是纯青与 faint）', () => {
    const p = resolvePalette('dark', { color: true, truecolor: true });
    expect(p.cyan('x')).toBe('\x1b[38;2;26;188;156mx\x1b[0m');
    expect(p.dim('x')).toBe('\x1b[38;2;108;108;108mx\x1b[0m');
    expect(p.border('x')).toBe('\x1b[38;2;80;80;88mx\x1b[0m');
    // 修饰符槽不随配色变（bold/inverse 是 SGR 属性，不是颜色）。
    expect(p.bold('x')).toBe('\x1b[1mx\x1b[0m');
    expect(p.inverse('x')).toBe('\x1b[7mx\x1b[0m');
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
