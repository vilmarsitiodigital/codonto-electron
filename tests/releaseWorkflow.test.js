const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('release por tag usa Windows, pnpm, testes e GITHUB_TOKEN', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '../.github/workflows/release.yml'),
    'utf8',
  );

  for (const required of [
    "tags:\n      - 'v*'",
    'contents: write',
    'runs-on: windows-latest',
    'version: 10.19.0',
    'pnpm install --frozen-lockfile',
    'pnpm exec playwright install chromium',
    'pnpm test',
    'GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    'pnpm run release:win',
  ]) {
    assert.match(workflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
