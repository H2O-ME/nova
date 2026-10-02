/**
 * The right panel's layout locks — the geometry a DOM-less lane cannot render
 * but can READ, because each rule here is the answer to a reported defect.
 *
 *  - **The tree's hover verbs leave the layout at rest.** With the rail always
 *    occupying its row's right edge, a dock dragged to its 160px floor leaves
 *    the file name one character wide (「这里被遮挡」). The reference holds the
 *    rail out of the layout until hover (`explorerRef: display:none`); a rail
 *    that returns to an always-present `opacity:0` re-breaks the name.
 *  - **An empty file page gives the tree the whole width.** Docking the tree
 *    beside a placeholder pane leaves most of the page blank (「左边这一大块
 *    白色空着」); the reference's path-less home tab is the standalone explorer.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const treeCss = readFileSync(fileURLToPath(new URL('../src/rightbar/TreeDock.module.css', import.meta.url)), 'utf8');
const filesCss = readFileSync(fileURLToPath(new URL('../src/rightbar/FilesView.module.css', import.meta.url)), 'utf8');
const filesView = readFileSync(fileURLToPath(new URL('../src/rightbar/FilesView.tsx', import.meta.url)), 'utf8');
const tasksTsx = readFileSync(fileURLToPath(new URL('../src/rightbar/TasksView.tsx', import.meta.url)), 'utf8');
const tasksCss = readFileSync(fileURLToPath(new URL('../src/rightbar/TasksView.module.css', import.meta.url)), 'utf8');

const dotCss = readFileSync(fileURLToPath(new URL('../src/tool/StateDot.module.css', import.meta.url)), 'utf8');
const dotTsx = readFileSync(fileURLToPath(new URL('../src/tool/StateDot.tsx', import.meta.url)), 'utf8');
function railRule(css: string): string {
  const at = css.indexOf('.rowRail {');
  expect(at, 'the tree must define .rowRail').toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
}

describe('tree dock row layout', () => {
  it('holds the hover rail OUT of the layout at rest (display, not opacity)', () => {
    const rule = railRule(treeCss);
    expect(rule).toContain('display: none;');
    expect(rule).not.toContain('opacity: 0;');
  });

  it('reveals the rail on hover, on focus, and while its menu is open', () => {
    expect(treeCss).toMatch(/\.row:hover \.rowRail,[\s\S]*?display: inline-flex;/);
    expect(treeCss).toMatch(/\.rowRail\[data-open\][\s\S]*?display: inline-flex;/);
  });

  it("parks the rail at the row's far edge so the name owns the rest", () => {
    expect(railRule(treeCss)).toContain('margin-left: auto;');
  });
});

describe('files page', () => {
  it('lets the tree own the page — always, not only while nothing is open', () => {
    // A click opens a file as its own strip tab (the reference's shape), so the
    // page never splits into tree + document pane: the dock is unconditionally
    // the page.
    expect(filesView).toContain('data-tree-full');
    expect(filesCss).toMatch(/\.dock \{[\s\S]*?flex: 1 1 auto;/);
    expect(filesCss).not.toContain('data-tree-full');
  });
});

describe('tasks page', () => {
  it('draws each state as a dot in that state’s own ink', () => {
    // The row's state marker is the reference's StateDot — the ONE dot recipe
    // (the rightbar used to carry a second, four-state copy of it) — and a
    // live row has no status word to fall back on, so the dot alone must say
    // `stopping`/`killed` (attention) apart from `running` (the spinner).
    expect(tasksTsx).toContain("import { StateDot } from '../tool/StateDot.js';");
    expect(tasksTsx).toContain('<StateDot state={jobDot(job.status)} />');
    expect(dotTsx).toContain("'done' | 'warning' | 'ongoing' | 'error' | 'idle'");
    expect(dotCss).toMatch(/\.dot\[data-state='done'\][^{]*\{[^}]*state-success-primary/);
    expect(dotCss).toMatch(/\.dot\[data-state='error'\][^{]*\{[^}]*state-error-primary/);
    expect(dotCss).toMatch(/\.dot\[data-state='warning'\][^{]*\{[^}]*state-warn-primary/);
  });

  it('keeps the stop out of the row and the confirm inside it', () => {
    // The two-press affordance: the button only exists on running rows, and
    // the armed state widens into a labeled pill instead of a tint only — a
    // confirmation nobody can read without hovering is not a confirmation.
    expect(tasksTsx).toContain("job.status === 'running' &&");
    expect(tasksTsx).toContain('phase === \'armed\' && <span className={css.stopLabel}>');
    expect(tasksCss).toMatch(/\.stopArmed,[\s\S]*?background: var\(--dsw-alias-interactive-bg-hover-danger\);/);
    expect(tasksCss).toMatch(/\.stopArmed,[\s\S]*?color: var\(--dsw-alias-state-error-primary\);/);
  });

  it('answers the empty state with one card, not stacked notices', () => {
    const card = /data-tasks-empty[\s\S]*?tasks\.empty'?\][\s\S]*?tasks\.empty\.note'/;
    expect(tasksTsx).toMatch(card);
    // The card breathes: it owns the page's middle, it does not stack at the top.
    expect(tasksCss).toMatch(/\.emptyCard \{[\s\S]*?justify-content: center;/);
  });
});
