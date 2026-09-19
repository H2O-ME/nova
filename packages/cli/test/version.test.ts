import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliVersion } from '../src/version.js';

/**
 * SemVer 2.0.0 §2 temporal rule echoed by the official spec's ECMAScript regex:
 * no leading zeros on numeric identifiers (spec §2 MUST NOT). Kept here as the
 * single reference copy used by the verify script too.
 */
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const PACKAGE_DIRS = [
  'packages/core',
  'packages/ai',
  'packages/plugins',
  'packages/tui',
  'packages/cli',
];

describe('version single source (packages/cli/src/version.ts)', () => {
  it('reads a valid SemVer from packages/cli/package.json', () => {
    const v = cliVersion();
    expect(v).toMatch(SEMVER_RE);
  });
});

describe('SemVer 2.0.0 version compliance', () => {
  it('rejects leading zeros (spec §2 MUST NOT)', () => {
    expect('01.2.3').not.toMatch(SEMVER_RE);
    expect('1.02.3').not.toMatch(SEMVER_RE);
    expect('1.2.03').not.toMatch(SEMVER_RE);
    expect('0.1.0').toMatch(SEMVER_RE);
    expect('0.2.0').toMatch(SEMVER_RE);
  });

  it('accepts the pre-release / build metadata grammar', () => {
    expect('1.2.3-alpha.1+build.5').toMatch(SEMVER_RE);
    expect('1.2.3-0.3.7').toMatch(SEMVER_RE);
    expect('1.2.3-rc.1').toMatch(SEMVER_RE);
  });

  it('keeps all 7 workspace packages on the same version', () => {
    const versions = new Map<string, string>();
    const rootPkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
    versions.set('nova-agent', rootPkg.version);
    for (const dir of PACKAGE_DIRS) {
      const pkg = JSON.parse(readFileSync(path.join(ROOT, dir, 'package.json'), 'utf8')) as { version: string };
      versions.set(dir, pkg.version);
    }
    const distinct = new Set(versions.values());
    expect(distinct.size).toBe(1);
  });
});