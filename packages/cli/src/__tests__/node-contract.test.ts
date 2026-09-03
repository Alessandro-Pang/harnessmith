import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('project declares Node 24.12 consistently across runtime and CI contracts', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const harnessManifest = JSON.parse(
    readFileSync(join(root, 'template', 'agent-harness', 'manifest.json'), 'utf8'),
  );
  const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const buildConfig = readFileSync(join(root, 'config', 'tsup.config.ts'), 'utf8');

  assert.equal(readFileSync(join(root, '.nvmrc'), 'utf8').trim(), 'v24.12.0');
  assert.equal(packageManifest.engines.node, '>=24.12.0');
  assert.equal(harnessManifest.node, '>=24.12.0');
  assert.match(workflow, /node: \[24\]/);
  assert.doesNotMatch(workflow, /node-version: 22/);
  assert.equal(buildConfig.match(/target: 'node24'/g)?.length, 2);
  assert.doesNotMatch(buildConfig, /target: 'node(?:20|22)'/);
});

test('Git normalizes text files to LF on every platform', () => {
  const attributes = readFileSync(join(root, '.gitattributes'), 'utf8');
  assert.match(attributes, /^\* text=auto eol=lf$/m);
});

test('Knip owns the dependency and dead-code contract for every TypeScript source tree', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const knip = JSON.parse(readFileSync(join(root, 'config', 'knip.json'), 'utf8')) as {
    project: string[];
  };

  assert.equal(
    packageManifest.scripts['quality:dead-code'],
    'knip --config config/knip.json --reporter compact',
  );
  assert.match(packageManifest.scripts.check, /pnpm run quality:dead-code/);
  for (const source of [
    '../packages/cli/src/**/*.ts',
    '../scripts/**/*.ts',
    '../packages/harness/src/**/*.ts',
  ]) {
    assert.ok(knip.project.includes(source), `Knip omits ${source}`);
  }
});

test('release verification reuses one quality build and one covered unit-test run', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const workflow = readFileSync(join(root, '.github', 'workflows', 'publish.yml'), 'utf8');
  const scripts = packageManifest.scripts;

  assert.equal(scripts['build:emit'], 'tsup --config config/tsup.config.ts');
  assert.equal(
    scripts['preflight:quality'],
    'pnpm run check && pnpm run build:emit && node --import tsx scripts/preflight/preflight.ts all',
  );
  assert.equal(scripts.preflight, 'pnpm run preflight:quality && pnpm run test:unit');
  assert.equal(
    scripts['release:quality'],
    'pnpm run check && pnpm run build:emit && pnpm run test:coverage:unit && pnpm run test:scripts-coverage',
  );
  assert.equal(scripts['release:check'], 'pnpm run release:quality && pnpm run eval:gate');
  assert.match(workflow, /pnpm run release:quality/);
  assert.doesNotMatch(workflow, /- run: pnpm run preflight\n/);
  assert.doesNotMatch(workflow, /- run: pnpm run test:coverage\n/);
});

test('eval checks build their fingerprint inputs in a clean checkout', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  assert.equal(packageManifest.scripts['preeval:check'], 'pnpm run build:emit');
  assert.equal(
    packageManifest.scripts['eval:check'],
    'vitest run --config config/vitest.config.ts evals/__tests__',
  );
});

test('npm package includes runtime guidance and eval contracts without source-only material', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    files: string[];
  };
  for (const path of [
    'llms.txt',
    'README.en.md',
    'SECURITY.md',
    'evals/scenarios.json',
    'evals/scenarios.schema.json',
    'evals/run.schema.json',
  ])
    assert.ok(manifest.files.includes(path), `npm package is missing: ${path}`);
  for (const path of [
    'CONTRIBUTING.md',
    'RELEASING.md',
    'CHANGELOG.md',
    'apps/docs/site/architecture.md',
    'evals/README.md',
    'evals/run.example.json',
  ])
    assert.ok(!manifest.files.includes(path), `npm package includes source-only material: ${path}`);
  assert.ok(!manifest.files.some((path) => path.includes('__tests__')));
  const evalIgnore = join(root, 'evals', '.npmignore');
  assert.equal(
    existsSync(evalIgnore),
    true,
    'eval package boundary must exclude its source README',
  );
  assert.match(readFileSync(evalIgnore, 'utf8'), /^README\.md$/m);
});

test('dependencies used only by the bundled Harness stay build-time dependencies', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const build = readFileSync(join(root, 'config', 'tsup.config.ts'), 'utf8');

  assert.match(build, /noExternal: \[\/\.\*\/\]/);
  for (const dependency of ['mdast-util-from-markdown', 'unist-util-visit']) {
    assert.equal(packageManifest.dependencies?.[dependency], undefined);
    assert.ok(packageManifest.devDependencies?.[dependency]);
  }
});

test('Markdown AST traversal uses the maintained unist visitor', () => {
  const source = readFileSync(
    join(root, 'packages', 'harness', 'src', 'lib', 'documentation', 'markdown-links.ts'),
    'utf8',
  );

  assert.match(source, /from ['"]unist-util-visit['"]/);
  assert.doesNotMatch(source, /function visit\s*\(/);
});

test('preflight mode parsing uses Commander choices', () => {
  const source = readFileSync(join(root, 'scripts', 'preflight', 'preflight.ts'), 'utf8');

  assert.match(source, /from ['"]commander['"]/);
  assert.match(source, /\.choices\(\['all', 'cli', 'docs'\]\)/);
  assert.match(source, /\.parse\(process\.argv\.slice\(2\), \{ from: 'user' \}\)/);
  assert.doesNotMatch(source, /process\.argv\.slice\(2,\s*3\)/);
  assert.doesNotMatch(source, /\['all', 'cli', 'docs'\]\.includes\(mode\)/);
});

test('built CLI preflight derives and exercises the complete Adapter set', () => {
  const source = readFileSync(join(root, 'scripts', 'preflight', 'preflight-adapters.ts'), 'utf8');

  assert.match(source, /supportedAgentNames/);
  assert.match(source, /\['install', '--agent', 'all'/);
  assert.match(source, /\['status', '--agent', 'all'/);
  assert.match(source, /\['uninstall', '--agent', 'all'/);
});

test('release manifest comparison uses Node deep equality', () => {
  const source = readFileSync(
    join(root, 'scripts', 'evaluation', 'records', 'eval-fingerprint.ts'),
    'utf8',
  );

  assert.match(source, /import \{ isDeepStrictEqual \} from ['"]node:util['"]/);
  assert.match(source, /isDeepStrictEqual\(candidatePackage, currentPackage\)/);
  assert.doesNotMatch(source, /function canonicalJson\s*\(/);
});

test('public guidance does not duplicate the package version', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = packageManifest.version as string;
  const guidancePaths = [
    'README.md',
    'README.en.md',
    'SECURITY.md',
    'llms.txt',
    'apps/docs/site/architecture.md',
  ];

  for (const path of guidancePaths) {
    const content = readFileSync(join(root, path), 'utf8');
    assert.ok(!content.includes(version), `${path} duplicates package version ${version}`);
  }
});

test('secret scanning covers every shipped guidance and source tree', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const command = packageManifest.scripts['quality:secrets'];

  for (const path of [
    'packages/cli/src/**/*',
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

test('secret scanning does not allowlist credential-shaped test fixtures', () => {
  const config = readFileSync(join(root, 'config', '.secretlintrc.json'), 'utf8');
  const validationTests = readFileSync(
    join(root, 'packages', 'harness', 'src', '__tests__', 'validation-libs.test.ts'),
    'utf8',
  );

  assert.doesNotMatch(config, /"allows"\s*:/);
  assert.doesNotMatch(validationTests, /xox[baprs]-\d{10,}-\d{10,}-[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(validationTests, /npm_[A-Za-z0-9]{30,}/);
});

test('project uses one pinned pnpm toolchain across manifests, CI, scripts, and hooks', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const hooks = ['commit-msg', 'pre-commit', 'pre-push'].map((name) =>
    readFileSync(join(root, '.husky', name), 'utf8'),
  );

  assert.equal(packageManifest.packageManager, 'pnpm@10.13.0');
  assert.equal(existsSync(join(root, 'pnpm-lock.yaml')), true);
  assert.equal(existsSync(join(root, 'package-lock.json')), false);
  assert.match(workflow, /pnpm\/action-setup@v6/);
  assert.match(workflow, /pnpm install --frozen-lockfile --ignore-scripts/);
  assert.doesNotMatch(workflow, /npm ci/);
  assert.equal(
    Object.values(packageManifest.scripts).some((script) =>
      /(^|[;&|]\s*)npm run\b/.test(String(script)),
    ),
    false,
  );
  assert.equal(
    hooks.some((hook) => /(^|[;&|]\s*)npm run\b/m.test(hook)),
    false,
  );
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
