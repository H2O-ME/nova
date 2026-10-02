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

/** The `.rowRail` rule's body (up to its closing brace). */
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
  it('lets the tree own the page while no document is open', () => {
    expect(filesView).toContain('data-tree-full');
    // The full-width rule must exist in the sheet, not only in the JSX.
    expect(filesCss).toMatch(/\[data-tree-full\] \.dock \{[\s\S]*?flex: 1 1 auto;/);
  });
});

describe('tasks page', () => {
  it('draws the status as a Tag with the state’s own ink', () => {
    // 「简陋落后」was a gray word among gray words: the reference's jobs drawer
    // gives each state a Tag pill in the state's ink.
    expect(tasksTsx).toContain('data-tasks-tag');
    expect(tasksCss).toMatch(/\.tag\[data-status='running'\][^{]*\{[^}]*state-business-primary/);
    expect(tasksCss).toMatch(/\.tag\[data-status='completed'\][^{]*\{[^}]*state-success-primary/);
    expect(tasksCss).toMatch(/\.tag\[data-status='failed'\][^{]*\{[^}]*state-error-primary/);
  });

  it('answers the empty state with one card, not stacked notices', () => {
    const card = /data-tasks-empty[\s\S]*?tasks\.empty'?\][\s\S]*?tasks\.empty\.note'/;
    expect(tasksTsx).toMatch(card);
    // The card breathes: it owns the page's middle, it does not stack at the top.
    expect(tasksCss).toMatch(/\.emptyCard \{[\s\S]*?justify-content: center;/);
  });
});
