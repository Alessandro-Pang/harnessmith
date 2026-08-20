import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function packageName(specifier: string): string {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
}

function runtimeImports(): string[] {
  const sourceRoot = join(root, 'src');
  const imports = readdirSync(sourceRoot, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile() || !entry.name.endsWith('.ts')) return [];
    const content = readFileSync(join(sourceRoot, entry.name), 'utf8');
    return [...content.matchAll(/from ['"]([^'"]+)['"]/g)].map((match) => match[1]);
  });
  return [
    ...new Set(
      imports
        .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('node:'))
        .map(packageName),
    ),
  ].sort();
}

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

test('every production import is declared as a runtime dependency', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const dependencies = new Set(Object.keys(packageManifest.dependencies ?? {}));

  assert.deepEqual(
    runtimeImports().filter((dependency) => !dependencies.has(dependency)),
    [],
  );
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
