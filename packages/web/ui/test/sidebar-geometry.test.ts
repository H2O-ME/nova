/**
 * 侧栏几何对齐（2026-11-15，对齐 ZCode 桌面端）。
 *
 * 这一批改动全是逐值复刻参考仓的侧栏度量（不新增行为），所以定时单测能守住的
 * 只有「这些值仍然来自同一处 token、且仍是参考的那几档」：行盒的 pl-2.5/pr-1、
 * 日期带的 pt-2/pb-1、列表头的 24px 控件、底部身份行的 32px 盒。任何一次重排
 * 把这些值改回自测数值，这里就会红——这是本批唯一的回归通道。
 *
 * 断言读的是 CSS Module 源文本（无 DOM 车道），只钉值与 token 来源，不钉注释。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** 取一个规则块的声明文本（注释已剥离，空白归一；多行选择器因此能按一行写）。 */
function declarations(sheet: string, selector: string): string {
  const flat = sheet.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ');
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(flat)?.[1] ?? '';
  return body.trim();
}

describe('sidebar geometry (ZCode alignment)', () => {
  it('the column has ONE 8px content inset, the reference\'s own px-2', () => {
    const sheet = read('sidebar/Sidebar.module.css');
    // ProjectSidebarNavigation.tsx:37 / ProjectSidebarListHeader.tsx:32 /
    // ProjectTaskRows.tsx:135 都是 `px-2`：aside 本身无内边距，净缩进 8px。
    expect(declarations(sheet, '.root')).toContain(
      '--nova-sidebar-inline-padding: var(--nova-space-8);'
    );
    // 纵向不留白：48px 拖拽条（project-sidebar/index.tsx:245）从 0 起步。
    expect(declarations(sheet, '.root')).toContain(
      'padding: 0 var(--nova-sidebar-inline-padding);'
    );
  });

  it('session rows carry the reference TaskListItem box', () => {
    const sheet = read('sidebar/SessionRow.module.css');
    // TaskListItem.tsx:628 — `gap-2 rounded-lg pl-2.5 pr-1`.
    const row = declarations(sheet, '.projectRow, .sessionRow');
    expect(row).toContain('gap: var(--nova-space-8);');
    expect(row).toContain('border-radius: var(--nova-radius-sm);');
    expect(row).toContain('padding: 0 var(--nova-space-4) 0 var(--nova-space-10);');
    // TaskListItem.tsx:628 timeline variant — `py-1.5` on the same pl/pr.
    expect(declarations(sheet, '.sessionRow.timelineRow')).toContain(
      'padding: var(--nova-space-6) var(--nova-space-4) var(--nova-space-6) var(--nova-space-10);'
    );
    // 单行行尾的印章是 `text-ui-sm`（12px），不是 10px 脚注（TaskListItem.tsx:864）。
    expect(declarations(sheet, '.time')).toContain('font-size: 12px;');
  });

  it('date bands and the list header keep the reference metrics', () => {
    const sheet = read('sidebar/SessionBrowser.module.css');
    // ProjectTaskRows.tsx:159-165 — `px-2.5 pt-2 pb-1 text-ui-base font-medium`.
    const band = declarations(sheet, '.groupHeading');
    expect(band).toContain(
      'padding: var(--nova-space-8) var(--nova-space-10) var(--nova-space-4);'
    );
    expect(band).toContain('font-size: 14px;');
    expect(band).toContain('font-weight: 500;');
    // ProjectSidebarListHeader.tsx:31 — `gap-1 px-2 pb-2` + icon-sm (24px).
    const header = declarations(sheet, '.sectionHeader');
    expect(header).toContain('height: 32px;');
    expect(header).toContain('padding: 0 0 var(--nova-space-8) var(--nova-space-10);');
    expect(declarations(sheet, '.iconButton')).toContain('width: 24px; height: 24px;');
  });

  it('the footer identity row is the reference 32px block', () => {
    const sheet = read('sidebar/SidebarFoot.module.css');
    // WorkspaceSidebarFooter.tsx:235 — `px-4 pt-2 pb-4` with a `gap-2` row; the
    // column already insets 8px, so the row adds 8 left / 4 right / 8 top /
    // 16 bottom as margins and padding.
    expect(declarations(sheet, '.triggerRow')).toContain(
      'margin: var(--nova-space-8) 0 var(--nova-space-16);'
    );
    expect(declarations(sheet, '.trigger')).toContain('height: 32px;');
    // WorkspaceSidebarFooter.tsx:163/476-487 — Avatar size default (32px) and
    // the gear's Button size icon-lg (32px).
    expect(declarations(sheet, '.avatar')).toContain('width: 32px; height: 32px;');
    expect(declarations(sheet, '.gear')).toContain('width: 32px; height: 32px;');
  });
});
