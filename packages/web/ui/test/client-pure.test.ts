/**
 * G4 验收判据的机械化（NOVA-GENERALIST §6 G4）：Client Model 不依赖 React。
 *
 * `src/client/` 是模型层（connection / model / protocol，及后续域模块）——
 * 它们必须是纯 TypeScript，可被任何 surface 复用；React 绑定只允许住在
 * `src/client.ts` 这个 hook 壳里。这是守卫类测试（readFileSync 断源码的
 * 唯一合法形态，同 style-guard）：断的是「这一层不 import react」这条
 * 结构不变量，不是任何行为。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const clientDir = fileURLToPath(new URL('../src/client/', import.meta.url));
const modules = readdirSync(clientDir).filter((f) => f.endsWith('.ts'));

describe('client model is React-free', () => {
  it('has modules to guard', () => {
    expect(modules).toContain('model.ts');
    expect(modules).toContain('connection.ts');
    expect(modules).toContain('protocol.ts');
  });

  it('imports react nowhere', () => {
    const offenders = modules.filter((file) => /from ['"]react/.test(readFileSync(join(clientDir, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
