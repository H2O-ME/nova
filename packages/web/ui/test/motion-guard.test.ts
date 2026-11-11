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

  it('message entrance is NOT replayed; the shared disclosure keyframes exist', () => {
    // W3 reversed this. The two sheets used to re-declare `nova-fade-up` on
    // EVERY message root, which replayed on each remount: scrolling a long
    // transcript made the page move continuously — the exact defect
    // `docs/NOVA-DESIGN-SYSTEM.md` §4.3 forbids ("no page always moving": a
    // per-message fade + tool slide + card expand + layout transitions all at
    // once). Arrival is signalled once by the turn header's own cue instead.
    for (const sheet of ['chat/MessageItem.module.css', 'chat/AssistantMessage.module.css']) {
      expect(read(sheet), `${sheet} must not replay a per-message entrance`).not.toContain('animation: nova-fade-up');
    }
    // The shared disclosure motion the transcript DOES use (W2) lives in the
    // global sheet, so every module references one definition.
    const sheet = read('design/motion.css');
    expect(sheet).toContain('@keyframes nova-collapse');
    expect(sheet).toContain('@keyframes nova-reveal');
  });

  it('row entrances use ONE shared fade definition, not seven private copies', () => {
    // W3 merged them. Six sheets each declared their own `from { opacity: 0 }`
    // keyframe (`wide-in` in three sidebar sheets, plus `row-in`, `rail-in`,
    // `dock-row-in`, `change-row-in`), and a CSS module only resolves keyframes
    // it declares itself — so those seven were seven definitions of one motion,
    // each free to drift on its own and none reachable from another sheet.
    const privateCopies = [
      'sidebar/Sidebar.module.css',
      'sidebar/SidebarFoot.module.css',
      'sidebar/SessionBrowser.module.css',
      'sidebar/SessionRow.module.css',
      'rightbar/TreeDock.module.css',
      'rightbar/ChangesView.module.css',
    ];
    for (const sheet of privateCopies) {
      const text = read(sheet);
      for (const name of ['wide-in', 'rail-in', 'rail-fade-in', 'row-in', 'dock-row-in', 'change-row-in']) {
        expect(text, `${sheet} must not re-declare @keyframes ${name}`).not.toMatch(
          new RegExp(`@keyframes\\s+${name}\\b`)
        );
      }
    }
    // The single definition every one of them now names.
    expect(read('design/motion.css')).toContain('@keyframes nova-fade-in');
  });

  it('the hero fish keeps an ambient idle swim and the step tick draws in', () => {
    expect(read('conversation/HeroShell.module.css')).toMatch(/@keyframes hero-fish-idle \{/);
    expect(read('tool/StateDot.module.css')).toMatch(/animation:\s*nova-draw\b/);
  });
});
