const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const pkg = require('../package.json');

test('configura versão, pnpm e atualização pelo GitHub', () => {
  assert.equal(pkg.version, '3.0.9');
  assert.equal(pkg.packageManager, 'pnpm@10.19.0');
  assert.deepEqual(pkg.pnpm.onlyBuiltDependencies, ['electron']);
  assert.equal(pkg.dependencies['electron-updater'], '^6.6.2');
  assert.equal(
    pkg.scripts['release:win'],
    'electron-builder --win --x64 --prepackaged dist/win-unpacked --publish always',
  );
  assert.deepEqual(pkg.build.publish, [{
    provider: 'github',
    owner: 'vilmarsitiodigital',
    repo: 'codonto-electron',
    releaseType: 'release',
  }]);
});

test('empacota dependências transitivas e verifica o app.asar antes da publicação', () => {
  const workspace = YAML.parse(fs.readFileSync(
    path.join(__dirname, '../pnpm-workspace.yaml'),
    'utf8',
  ));

  assert.equal(workspace.nodeLinker, 'hoisted');
  assert.equal(pkg.scripts['package:win:dir'], 'electron-builder --win --x64 --dir');
  assert.equal(pkg.scripts['verify:package'], 'node scripts/verify-packaged-dependencies.js');
  assert.ok(pkg.devDependencies['@electron/asar']);
});

test('usa descoberta nativa de testes sem depender de glob do shell', () => {
  assert.equal(pkg.scripts.test, 'node --test');
});
