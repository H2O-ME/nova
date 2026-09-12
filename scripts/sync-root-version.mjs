import { readFileSync, writeFileSync } from 'node:fs';

const rootPath = 'package.json';
const cliPath = 'packages/cli/package.json';

const root = JSON.parse(readFileSync(rootPath, 'utf8'));
const cli = JSON.parse(readFileSync(cliPath, 'utf8'));

if (root.version !== cli.version) {
  root.version = cli.version;
  writeFileSync(rootPath, JSON.stringify(root, null, 2) + '\n');
  console.log(`synced root package.json version -> ${cli.version}`);
}
