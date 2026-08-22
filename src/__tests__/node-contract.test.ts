import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('project declares Node 24.12 consistently across runtime and CI contracts', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const harnessManifest = JSON.parse(
    readFileSync(join(root, 'template', 'agent-harness', 'manifest.json'), 'utf8'),
  );
  const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const buildConfig = readFileSync(join(root, 'tsup.config.ts'), 'utf8');

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
  const knip = JSON.parse(readFileSync(join(root, 'knip.json'), 'utf8')) as {
    project: string[];
  };

  assert.equal(packageManifest.scripts['quality:dead-code'], 'knip --reporter compact');
  assert.match(packageManifest.scripts.check, /pnpm run quality:dead-code/);
  for (const source of ['src/**/*.ts', 'scripts/**/*.ts', 'template/agent-harness/src/**/*.ts']) {
    assert.ok(knip.project.includes(source), `Knip omits ${source}`);
  }
});

test('dependencies used only by the bundled Harness stay build-time dependencies', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const build = readFileSync(join(root, 'tsup.config.ts'), 'utf8');

  assert.match(build, /noExternal: \[\/\.\*\/\]/);
  for (const dependency of ['mdast-util-from-markdown', 'unist-util-visit']) {
    assert.equal(packageManifest.dependencies?.[dependency], undefined);
    assert.ok(packageManifest.devDependencies?.[dependency]);
  }
});

test('Markdown AST traversal uses the maintained unist visitor', () => {
  const source = readFileSync(
    join(root, 'template', 'agent-harness', 'src', 'lib', 'markdown-links.ts'),
    'utf8',
  );

  assert.match(source, /from ['"]unist-util-visit['"]/);
  assert.doesNotMatch(source, /function visit\s*\(/);
});

test('preflight mode parsing uses Commander choices', () => {
  const source = readFileSync(join(root, 'scripts', 'preflight.ts'), 'utf8');

  assert.match(source, /from ['"]commander['"]/);
  assert.match(source, /\.choices\(\['all', 'cli', 'docs'\]\)/);
  assert.match(source, /\.parse\(process\.argv\.slice\(2\), \{ from: 'user' \}\)/);
  assert.doesNotMatch(source, /process\.argv\.slice\(2,\s*3\)/);
  assert.doesNotMatch(source, /\['all', 'cli', 'docs'\]\.includes\(mode\)/);
});

test('release manifest comparison uses Node deep equality', () => {
  const source = readFileSync(join(root, 'scripts', 'eval-fingerprint.ts'), 'utf8');

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
    'docs/architecture.md',
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
    'src/**/*',
    'scripts/**/*',
    'template/**/*',
    'evals/**/*',
    'docs/**/*',
    '.github/**/*',
    '.husky/**/*',
    '*.json',
  ]) {
    assert.ok(command.includes(`"${path}"`), `secret scan omits ${path}`);
  }
});

test('secret scanning does not allowlist credential-shaped test fixtures', () => {
  const config = readFileSync(join(root, '.secretlintrc.json'), 'utf8');
  const validationTests = readFileSync(
    join(root, 'template', 'agent-harness', 'src', '__tests__', 'validation-libs.test.ts'),
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
