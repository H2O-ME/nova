import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path, { relative } from 'node:path';
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

/** Every workspace package directory, discovered rather than listed. */
function workspacePackages(): { dir: string; name: string; version: string; private?: boolean }[] {
  const dir = path.join(ROOT, 'packages');
  return readdirSync(dir)
    .map((name) => path.join(dir, name))
    .filter((full) => statSync(full).isDirectory() && existsSync(path.join(full, 'package.json')))
    .map((full) => {
      const pkg = JSON.parse(readFileSync(path.join(full, 'package.json'), 'utf8')) as {
        name: string;
        version: string;
        private?: boolean;
      };
      return { dir: relative(ROOT, full).replace(/\\/g, '/'), ...pkg };
    });
}

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

  it('keeps the changesets fixed group on one version, and lists only real packages', () => {
    // The lockstep group IS the release contract: a name here that no longer
    // exists makes `changeset version` fail outright (it did, when the old TUI
    // packages were deleted), and a package that should be in it but is not
    // would ship a version skew. Both are checked against the workspace on disk.
    const config = JSON.parse(readFileSync(path.join(ROOT, '.changeset', 'config.json'), 'utf8')) as {
      fixed: string[][];
    };
    const packages = workspacePackages();
    const known = new Set(packages.map((p) => p.name));
    const group = config.fixed.flat();
    expect(group.length).toBeGreaterThan(0);
    for (const name of group) expect(known).toContain(name);

    const versions = new Set(packages.filter((p) => group.includes(p.name)).map((p) => p.version));
    const rootPkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string };
    versions.add(rootPkg.version);
    expect([...versions]).toHaveLength(1);
    // `qqbot` is deliberately outside the group (third-party plugin demo).
    expect(group).not.toContain('@nova-agent/qqbot');
  });
});