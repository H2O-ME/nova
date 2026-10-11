/**
 * Motion-system guard. The shared timing tokens live in the Nova token layer
 * (`design/tokens/motion.css`); the shared sheet `design/motion.css` owns the
 * global keyframes and the reduced-motion clamp; component sheets reference
 * those names (CSS modules hash only keyframes they define themselves, so a
 * typo here silently styles nothing — the failure mode this pins). The
 * reduced-motion clamp must stay mounted: it is the single off-switch every
 * animated module relies on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('motion system', () => {
  it('the motion sheets are mounted by the Nova design sheet', () => {
    const mount = read('design/index.css');
    expect(mount).toContain('./motion.css');
    expect(mount).toContain('./tokens/motion.css');
  });

  it('motion sheets declare the shared tokens, keyframes and the reduced-motion clamp', () => {
    const tokens = read('design/tokens/motion.css');
    for (const token of [
      '--nova-ease-out',
      '--nova-ease-spring',
      '--nova-ease-inout',
      '--nova-dur-instant',
      '--nova-dur-fast',
      '--nova-dur-base',
      '--nova-dur-slow',
    ]) {
      expect(tokens).toContain(`${token}:`);
    }
    const sheet = read('design/motion.css');
    for (const keyframe of ['@keyframes nova-fade-up', '@keyframes nova-pop-in', '@keyframes nova-draw']) {
      expect(sheet).toContain(keyframe);
    }
    expect(sheet).toContain('prefers-reduced-motion: reduce');
  });

  it('message entrances reference the shared fade-up keyframe', () => {
    expect(read('chat/MessageItem.module.css')).toContain('animation: nova-fade-up');
    expect(read('chat/AssistantMessage.module.css')).toContain('animation: nova-fade-up');
  });

  it('the hero fish keeps an ambient idle swim and the step tick draws in', () => {
    expect(read('conversation/HeroShell.module.css')).toMatch(/@keyframes hero-fish-idle \{/);
    expect(read('tool/StateDot.module.css')).toMatch(/animation:\s*nova-draw\b/);
  });
});
