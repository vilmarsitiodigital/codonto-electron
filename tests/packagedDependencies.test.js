const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createArchiveManifestReader,
  verifyDependencyGraph,
} = require('../scripts/verify-packaged-dependencies');

function createArchive(packages) {
  const manifests = new Map(Object.entries(packages).map(([packageDir, version]) => [
    `${packageDir}/package.json`,
    { version },
  ]));

  return {
    packageManifestPaths: [...manifests.keys()],
    readPackageManifest: (manifestPath) => manifests.get(manifestPath),
  };
}

test('valida dependências hoisted e aninhadas pela resolução real do módulo', () => {
  const packageTree = [{
    dependencies: {
      axios: {
        version: '1.0.0',
        dependencies: {
          'form-data': {
            version: '2.0.0',
            dependencies: {
              asynckit: { version: '3.0.0' },
            },
          },
        },
      },
    },
  }];
  const archive = createArchive({
    '/node_modules/axios': '1.0.0',
    '/node_modules/axios/node_modules/form-data': '2.0.0',
    '/node_modules/asynckit': '3.0.0',
  });

  assert.deepEqual(verifyDependencyGraph(packageTree, archive), {
    excluded: [],
    verifiedEdges: 3,
    verifiedPackages: 3,
  });
});

test('rejeita pacote que existe apenas sob um pai que não pode resolvê-lo', () => {
  const packageTree = [{
    dependencies: {
      axios: {
        version: '1.0.0',
        dependencies: {
          'form-data': { version: '2.0.0' },
        },
      },
    },
  }];
  const archive = createArchive({
    '/node_modules/axios': '1.0.0',
    '/node_modules/unrelated/node_modules/form-data': '2.0.0',
  });

  assert.throws(
    () => verifyDependencyGraph(packageTree, archive),
    /axios@1\.0\.0 não resolve form-data@2\.0\.0/,
  );
});

test('relata todas as dependências obrigatórias ausentes no mesmo diagnóstico', () => {
  const packageTree = [{
    dependencies: {
      axios: {
        version: '1.0.0',
        dependencies: {
          'follow-redirects': { version: '1.0.0' },
          'form-data': { version: '2.0.0' },
        },
      },
    },
  }];
  const archive = createArchive({
    '/node_modules/axios': '1.0.0',
  });

  assert.throws(
    () => verifyDependencyGraph(packageTree, archive),
    (error) => (
      error.message.includes('axios@1.0.0 não resolve follow-redirects@1.0.0')
      && error.message.includes('axios@1.0.0 não resolve form-data@2.0.0')
    ),
  );
});

test('rejeita a versão errada mesmo quando o nome do pacote está resolvível', () => {
  const packageTree = [{
    dependencies: {
      axios: {
        version: '1.0.0',
        dependencies: {
          'form-data': { version: '2.0.0' },
        },
      },
    },
  }];
  const archive = createArchive({
    '/node_modules/axios': '1.0.0',
    '/node_modules/form-data': '1.9.0',
  });

  assert.throws(
    () => verifyDependencyGraph(packageTree, archive),
    /form-data: esperada 2\.0\.0, encontrada 1\.9\.0/,
  );
});

test('valida versões duplicadas no local correto e pacotes com escopo', () => {
  const packageTree = [{
    dependencies: {
      axios: {
        version: '1.0.0',
        dependencies: {
          helper: { version: '2.0.0' },
        },
      },
      '@scope/runtime': {
        version: '4.0.0',
        dependencies: {
          helper: { version: '1.0.0' },
        },
      },
    },
  }];
  const archive = createArchive({
    '/node_modules/axios': '1.0.0',
    '/node_modules/axios/node_modules/helper': '2.0.0',
    '/node_modules/@scope/runtime': '4.0.0',
    '/node_modules/helper': '1.0.0',
  });

  assert.deepEqual(verifyDependencyGraph(packageTree, archive), {
    excluded: [],
    verifiedEdges: 4,
    verifiedPackages: 4,
  });
});

test('reporta apenas a exceção auditada para tipagem sem código de execução', () => {
  const packageTree = [{
    dependencies: {
      winston: {
        version: '3.0.0',
        dependencies: {
          '@types/triple-beam': { version: '1.3.5' },
        },
      },
    },
  }];
  const archive = createArchive({
    '/node_modules/winston': '3.0.0',
  });

  assert.deepEqual(verifyDependencyGraph(packageTree, archive), {
    excluded: ['@types/triple-beam'],
    verifiedEdges: 1,
    verifiedPackages: 1,
  });
});

test('rejeita dependência opcional instalada que ficou fora do pacote', () => {
  const packageTree = [{
    optionalDependencies: {
      'platform-runtime': { version: '1.0.0' },
    },
  }];
  const archive = createArchive({});

  assert.throws(
    () => verifyDependencyGraph(packageTree, archive),
    /aplicação não resolve platform-runtime@1\.0\.0/,
  );
});

test('normaliza caminhos do app.asar no Windows sem alterar o caminho de extração', () => {
  let extractedPath;
  const archive = createArchiveManifestReader('app.asar', {
    listPackage: () => [
      '\\node_modules\\axios\\package.json',
    ],
    extractFile: (_asarPath, manifestPath) => {
      extractedPath = manifestPath;
      return Buffer.from('{"version":"1.0.0"}');
    },
  });

  assert.deepEqual(archive.packageManifestPaths, [
    '/node_modules/axios/package.json',
  ]);
  assert.deepEqual(verifyDependencyGraph([{
    dependencies: {
      axios: { version: '1.0.0' },
    },
  }], archive), {
    excluded: [],
    verifiedEdges: 1,
    verifiedPackages: 1,
  });
  assert.equal(extractedPath, 'node_modules\\axios\\package.json');
});
