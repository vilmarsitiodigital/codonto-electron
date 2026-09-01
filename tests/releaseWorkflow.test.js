const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function assertReleaseWorkflow(workflow) {
  const normalizedWorkflow = workflow.replace(/\r\n/g, '\n');

  for (const required of [
    "tags:\n      - 'v*'",
    'contents: write',
    'runs-on: windows-latest',
    'version: 10.19.0',
    'pnpm install --frozen-lockfile',
    'Verify tag matches package version',
    '$expectedTag = "v$((Get-Content package.json | ConvertFrom-Json).version)"',
    'if ($env:GITHUB_REF_NAME -ne $expectedTag)',
    'pnpm exec playwright install chromium',
    'pnpm test',
    'GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    'pnpm run release:win',
  ]) {
    assert.match(normalizedWorkflow, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const guardPosition = normalizedWorkflow.indexOf('Verify tag matches package version');
  assert.ok(guardPosition < normalizedWorkflow.indexOf('pnpm test'));
  assert.ok(guardPosition < normalizedWorkflow.indexOf('pnpm run release:win'));
}

test('release por tag usa Windows, pnpm, testes e GITHUB_TOKEN', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '../.github/workflows/release.yml'),
    'utf8',
  );

  assertReleaseWorkflow(workflow);
});

test('valida o workflow após checkout com finais de linha do Windows', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '../.github/workflows/release.yml'),
    'utf8',
  ).replace(/\n/g, '\r\n');

  assertReleaseWorkflow(workflow);
});
