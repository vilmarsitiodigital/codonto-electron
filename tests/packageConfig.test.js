const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('configura versão, pnpm e atualização pelo GitHub', () => {
  assert.equal(pkg.version, '3.0.2');
  assert.equal(pkg.packageManager, 'pnpm@10.19.0');
  assert.deepEqual(pkg.pnpm.onlyBuiltDependencies, ['electron']);
  assert.equal(pkg.dependencies['electron-updater'], '^6.6.2');
  assert.equal(pkg.scripts['release:win'], 'electron-builder --win --x64 --publish always');
  assert.deepEqual(pkg.build.publish, [{
    provider: 'github',
    owner: 'vilmarsitiodigital',
    repo: 'codonto-electron',
    releaseType: 'release',
  }]);
});

test('usa descoberta nativa de testes sem depender de glob do shell', () => {
  assert.equal(pkg.scripts.test, 'node --test');
});
