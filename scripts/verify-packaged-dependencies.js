const path = require('node:path');
const { execFileSync } = require('node:child_process');
const asar = require('@electron/asar');

const AUDITED_EXCLUSIONS = new Set([
  // Declarações TypeScript sem código executável; o electron-builder remove @types do pacote final.
  '@types/triple-beam',
]);

function packageLookupCandidates(parentPackageDir, packageName) {
  const candidates = [];
  let currentDir = parentPackageDir;

  while (true) {
    if (path.posix.basename(currentDir) !== 'node_modules') {
      candidates.push(path.posix.join(currentDir, 'node_modules', packageName));
    }

    const parentDir = path.posix.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return [...new Set(candidates)];
}

function verifyDependencyGraph(packageTree, {
  packageManifestPaths,
  readPackageManifest,
}) {
  const availableManifests = new Set(packageManifestPaths);
  const excluded = new Set();
  const errors = [];
  const visitedPackages = new Set();
  let verifiedEdges = 0;

  function verifyDependencies(dependencies, parentPackageDir, parentLabel) {
    for (const [name, metadata] of Object.entries(dependencies || {})) {
      if (AUDITED_EXCLUSIONS.has(name)) {
        excluded.add(name);
        continue;
      }

      const packageDir = packageLookupCandidates(parentPackageDir, name).find((candidate) => (
        availableManifests.has(`${candidate}/package.json`)
      ));

      if (!packageDir) {
        errors.push(`${parentLabel} não resolve ${name}@${metadata.version}`);
        continue;
      }

      const manifest = readPackageManifest(`${packageDir}/package.json`);
      if (manifest.version !== metadata.version) {
        errors.push(
          `${name}: esperada ${metadata.version}, encontrada ${manifest.version} em ${packageDir}`,
        );
        continue;
      }

      verifiedEdges += 1;
      const visitKey = `${packageDir}@${manifest.version}`;
      if (visitedPackages.has(visitKey)) {
        continue;
      }

      visitedPackages.add(visitKey);
      const packageLabel = `${name}@${manifest.version}`;
      verifyDependencies(metadata.dependencies, packageDir, packageLabel);
      verifyDependencies(metadata.optionalDependencies, packageDir, packageLabel);
    }
  }

  for (const project of packageTree) {
    verifyDependencies(project.dependencies, '/', 'aplicação');
    verifyDependencies(project.optionalDependencies, '/', 'aplicação');
  }

  if (errors.length > 0) {
    throw new Error(`Grafo de dependências incompleto:\n- ${errors.join('\n- ')}`);
  }

  return {
    excluded: [...excluded].sort(),
    verifiedEdges,
    verifiedPackages: visitedPackages.size,
  };
}

function readProductionTree(projectDir) {
  const pnpmCli = process.env.npm_execpath;
  const args = ['list', '--prod', '--json', '--depth', 'Infinity'];
  const output = pnpmCli
    ? execFileSync(process.execPath, [pnpmCli, ...args], {
      cwd: projectDir,
      encoding: 'utf8',
    })
    : execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, {
      cwd: projectDir,
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });

  return JSON.parse(output);
}

function createArchiveManifestReader(asarPath, asarApi = asar) {
  const originalPathByNormalized = new Map();

  for (const originalPath of asarApi.listPackage(asarPath)) {
    const normalizedPath = originalPath.replace(/\\/g, '/');
    if (normalizedPath.includes('/node_modules/') && normalizedPath.endsWith('/package.json')) {
      originalPathByNormalized.set(normalizedPath, originalPath);
    }
  }

  return {
    packageManifestPaths: [...originalPathByNormalized.keys()],
    readPackageManifest: (normalizedPath) => {
      const originalPath = originalPathByNormalized.get(normalizedPath);
      return JSON.parse(
        asarApi.extractFile(asarPath, originalPath.slice(1)).toString('utf8'),
      );
    },
  };
}

function verifyPackagedDependencies({
  projectDir = process.cwd(),
  asarPath = path.join(projectDir, 'dist', 'win-unpacked', 'resources', 'app.asar'),
} = {}) {
  return verifyDependencyGraph(
    readProductionTree(projectDir),
    createArchiveManifestReader(asarPath),
  );
}

if (require.main === module) {
  try {
    const result = verifyPackagedDependencies();
    console.log(
      `app.asar verificado: ${result.verifiedPackages} pacotes e `
      + `${result.verifiedEdges} relações de produção resolvíveis.`,
    );
    if (result.excluded.length > 0) {
      console.log(`Exclusões auditadas: ${result.excluded.join(', ')}.`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  createArchiveManifestReader,
  packageLookupCandidates,
  verifyDependencyGraph,
  verifyPackagedDependencies,
};
