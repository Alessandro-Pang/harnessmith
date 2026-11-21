import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('project declares the Node 22.20 runtime floor consistently across runtime and build contracts', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const harnessManifest = JSON.parse(
    readFileSync(join(root, 'template', 'skills', 'agent-harness', 'manifest.json'), 'utf8'),
  );
  const buildConfig = readFileSync(join(root, 'config', 'tsup.config.ts'), 'utf8');
  const typesVersion = String(packageManifest.devDependencies['@types/node']);

  // Development pins the current LTS major; the distributed CLI runs on the lower runtime floor.
  assert.match(readFileSync(join(root, '.nvmrc'), 'utf8').trim(), /^v24\./);
  assert.equal(packageManifest.engines.node, '>=22.20.0');
  assert.equal(harnessManifest.node, '>=22.20.0');
  // Types and every build target follow the floor so newer runtime APIs cannot slip into
  // shipped code unnoticed. The CI matrix that exercises the floor is owned by
  // github-templates.test.ts.
  assert.match(typesVersion, /^22\./);
  const targets = [...buildConfig.matchAll(/target: '([^']+)'/g)].map((match) => match[1]);
  assert.ok(targets.length > 0, 'tsup config must declare build targets');
  for (const target of targets) assert.equal(target, 'node22');
});

test('Git normalizes text files to LF on every platform', () => {
  const attributes = readFileSync(join(root, '.gitattributes'), 'utf8');
  assert.match(attributes, /^\* text=auto eol=lf$/m);
});

test('the dead-code gate runs Knip with the repository config and stays in the check pipeline', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const deadCode = packageManifest.scripts['quality:dead-code'];

  assert.ok(deadCode, 'package.json must define the dead-code script');
  // Only the tool and config identity are contractual; reporter and include flags may evolve.
  // Workspace pattern coverage is owned by knip-surface.test.ts.
  assert.match(deadCode, /\bknip\b/);
  assert.ok(deadCode.includes('config/knip.json'), 'dead-code gate must use config/knip.json');
  assert(packageManifest.scripts.check, 'package.json must define the check script');
  assert.match(packageManifest.scripts.check, /pnpm run quality:dead-code/);
});

test('npm package exposes only the stable CLI entry and package metadata', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    main?: string;
    types?: string;
    exports?: Record<string, unknown>;
  };
  assert.equal(manifest.main, './dist/cli.js');
  assert.equal(manifest.types, './dist/cli.d.ts');
  assert.deepEqual(manifest.exports, {
    '.': {
      types: './dist/cli.d.ts',
      import: './dist/cli.js',
    },
    './package.json': './package.json',
  });
});

test('secret scanning covers every shipped guidance and source tree', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const command = packageManifest.scripts['quality:secrets'];
  assert(command, 'package.json must define the secret-scanning script');

  for (const path of [
    'packages/cli/src/**/*',
    'packages/harness/**/*',
    'scripts/**/*',
    'template/**/*',
    'evals/**/*',
    'apps/docs/site/**/*',
    '.github/**/*',
    '.husky/**/*',
    '*.json',
  ]) {
    assert.ok(command.includes(`"${path}"`), `secret scan omits ${path}`);
  }
});

test('secret scanning does not allowlist credential-shaped content', () => {
  const config = readFileSync(join(root, 'config', '.secretlintrc.json'), 'utf8');

  assert.doesNotMatch(config, /"allows"\s*:/);
});

test('Git hooks compose scripts with pnpm, never npm', () => {
  // Manifest, lockfile, CI setup, and package-script composition are owned by
  // scripts/preflight/preflight-package.ts; hooks are not covered there.
  for (const name of ['commit-msg', 'pre-commit', 'pre-push']) {
    const hook = readFileSync(join(root, '.husky', name), 'utf8');
    assert.equal(/(^|[;&|]\s*)npm run\b/m.test(hook), false, `${name} must not call npm run`);
  }
});

test('pre-push isolates repository-local Git environment before fixture tests', () => {
  const hook = readFileSync(join(root, '.husky', 'pre-push'), 'utf8');

  const localGitEnvironment = [
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CONFIG',
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT',
    'GIT_OBJECT_DIRECTORY',
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_IMPLICIT_WORK_TREE',
    'GIT_GRAFT_FILE',
    'GIT_INDEX_FILE',
    'GIT_NO_REPLACE_OBJECTS',
    'GIT_REPLACE_REF_BASE',
    'GIT_PREFIX',
    'GIT_SHALLOW_FILE',
    'GIT_COMMON_DIR',
  ];
  const unset = hook.split('\n').find((line) => line.startsWith('unset ')) || '';
  for (const variable of localGitEnvironment) assert.match(unset, new RegExp(`\\b${variable}\\b`));
  assert.match(hook, /pnpm run preflight/);
});
