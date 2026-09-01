const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseReleaseWorkflow } = require('./helpers/releaseWorkflow');
const pkg = require('../package.json');

function readWorkflow() {
  return fs.readFileSync(
    path.join(__dirname, '../.github/workflows/release.yml'),
    'utf8',
  );
}

test('release por tag usa Windows, pnpm, testes e GITHUB_TOKEN', () => {
  const workflow = parseReleaseWorkflow(readWorkflow());
  const job = workflow.jobs['release-win'];
  const steps = job.steps;

  assert.deepEqual(workflow.on.push.tags, ['v*']);
  assert.equal(workflow.permissions.contents, 'write');
  assert.equal(job['runs-on'], 'windows-latest');
  assert.equal(steps.find((step) => step.uses === 'pnpm/action-setup@v4').with.version, '10.19.0');
  assert.ok(steps.some((step) => step.run === 'pnpm install --frozen-lockfile'));
  assert.ok(steps.some((step) => step.run === 'pnpm exec playwright install chromium'));
  assert.ok(steps.some((step) => step.run === 'pnpm test'));

  const packagePosition = steps.findIndex((step) => step.run === 'pnpm run package:win:dir');
  const verifyPosition = steps.findIndex((step) => step.run === 'pnpm run verify:package');
  const publishPosition = steps.findIndex((step) => step.run === 'pnpm run release:win');
  assert.ok(packagePosition > -1);
  assert.ok(verifyPosition > packagePosition);
  assert.ok(publishPosition > verifyPosition);
  assert.match(pkg.scripts['release:win'], /--prepackaged dist\/win-unpacked/);

  const publishStep = steps.find((step) => step.run === 'pnpm run release:win');
  assert.equal(publishStep.env.GH_TOKEN, '${{ secrets.GITHUB_TOKEN }}');

  const guardPosition = steps.findIndex((step) => step.name === 'Verify tag matches package version');
  assert.ok(guardPosition < steps.findIndex((step) => step.run === 'pnpm test'));
  assert.ok(guardPosition < steps.findIndex((step) => step.run === 'pnpm run release:win'));
});

test('valida o workflow após checkout com finais de linha do Windows', () => {
  const windowsWorkflow = readWorkflow().replace(/\r?\n/g, '\r\n');
  const workflow = parseReleaseWorkflow(windowsWorkflow);

  assert.deepEqual(workflow.on.push.tags, ['v*']);
});
