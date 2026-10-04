/**
 * 失败行的「原因」两处可见面 + 文本卫生的直测（一条，合并规程）。
 *
 * 三个缺口是同一件事的两面：数据（roster 的 `error`）一直都在，缺的是**呈现**——启动
 * 报告把失败行整行剔掉、`/plugins` 的行丢掉 `error` 字段。所以这条测试钉的是呈现契约：
 * 失败行必须带原因、关着的行必须不带、原因里的控制码不得原样落到终端行上。把
 * `oneLineText` 的调用或 `error` 的传递删掉，这条即红。
 */
import { describe, expect, it } from 'vitest';
import type { AgentSurfacePluginRow } from '@nova-agent/core';
import { pluginRosterLine } from '../src/command-core.js';
import { failedPluginLines, pluginRowState } from '../src/plugin-report.js';

function row(over: Partial<AgentSurfacePluginRow> & { name: string }): AgentSurfacePluginRow {
  return { state: 'active', enabled: true, ...over };
}

/** The `/plugins` row shape also carries declared deps (its own renderer needs them). */
function pluginsRow(over: Partial<AgentSurfacePluginRow> & { name: string }): AgentSurfacePluginRow & { inject: string[] } {
  return { ...row(over), inject: [] };
}

/** Any C0/DEL control code point left in `text` — the injection this contract forbids. */
function hasControl(text: string): boolean {
  return [...text].some((ch) => {
    const code = ch.codePointAt(0) ?? 0x20;
    return code < 0x20 || code === 0x7f;
  });
}

describe('插件行的失败原因（可见性契约）', () => {
  it('启动报告与 /plugins 都带原因、关着的行不带，且原因不可注入终端', () => {
    // 一个注入性的原因：回车 + 换行 + ANSI 前景色 + BEL。任何一个原样落到终端都能改写
    // 已经打印的字或终端状态。
    const broken = row({
      name: 'nova-definitely-not-installed',
      state: 'failed',
      enabled: false,
      error: 'cannot load\rOVERWRITE\n\u001b[31mred\u0007',
    });
    const off = row({ name: '@nova-agent/plugin-ptc', state: 'disabled', enabled: false });
    const live = row({ name: 'bash', state: 'active' });

    // 启动报告：只有失败行被念出来，且逐行点名 id + 原因。
    const startup = failedPluginLines([live, broken, off]);
    expect(startup).toHaveLength(1);
    expect(startup[0]).toContain('nova-definitely-not-installed');
    expect(startup[0]).toContain('cannot load');
    // 卫生：控制码以可见转义出现，原文一个字节都不生效。
    expect(startup[0]).toContain('\\r');
    expect(startup[0]).toContain('\\n');
    expect(startup[0]).toContain('\\x1b');
    expect(hasControl(startup[0])).toBe(false);
    // 关着的行不是失败行：没有原因可报，也不该被念。
    expect(startup.some((line) => line.includes('plugin-ptc'))).toBe(false);

    // /plugins：失败行带原因，disabled 行**不带原因**（健康地关着没有要解释的事）。
    const failedLine = pluginRosterLine(pluginsRow(broken));
    expect(failedLine).toContain('failed');
    expect(failedLine).toContain(' — cannot load');
    expect(hasControl(failedLine)).toBe(false);
    const offLine = pluginRosterLine(pluginsRow(off));
    expect(offLine).toContain('disabled');
    expect(offLine).not.toContain(' — ');

    // 四种成因的判定是通用的（按行 id 查 roster），失败优先于「关着」——一条加载失败的
    // 行确实是 enabled: false，先问 enabled 就会把「模块加载不了」说成「你去打开它」。
    const rows = [broken, off, live];
    expect(pluginRowState(rows, 'nova-definitely-not-installed')).toEqual({
      kind: 'failed',
      error: broken.error,
    });
    expect(pluginRowState(rows, '@nova-agent/plugin-ptc').kind).toBe('off');
    expect(pluginRowState(rows, 'bash').kind).toBe('active');
    expect(pluginRowState(rows, 'not-configured-at-all').kind).toBe('absent');
  });
});
