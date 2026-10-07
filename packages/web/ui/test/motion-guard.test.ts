/**
 * Motion-system guard. The shared sheet `styles/motion.css` owns the timing
 * tokens, the global keyframes and the reduced-motion clamp; component sheets
 * reference those names (CSS modules hash only keyframes they define
 * themselves, so a typo here silently styles nothing — the failure mode this
 * pins). The reduced-motion clamp must stay mounted: it is the single
 * off-switch every animated module relies on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

describe('motion system', () => {
  it('the motion sheet is mounted by the global sheet', () => {
    expect(read('index.css')).toContain('styles/motion.css');
  });

  it('motion.css declares the shared tokens, keyframes and the reduced-motion clamp', () => {
    const sheet = read('styles/motion.css');
    for (const token of ['--nova-ease-out', '--nova-ease-spring', '--nova-dur-fast', '--nova-dur-base']) {
      expect(sheet).toContain(`${token}:`);
    }
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
