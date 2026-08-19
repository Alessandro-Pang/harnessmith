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

test('release documentation matches the package version', () => {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = packageManifest.version as string;
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const englishReadme = readFileSync(join(root, 'README.en.md'), 'utf8');
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const security = readFileSync(join(root, 'SECURITY.md'), 'utf8');
  const llms = readFileSync(join(root, 'llms.txt'), 'utf8');

  assert.match(readme, new RegExp(`当前 npm 版本：\\\`${version}\\\``));
  assert.match(englishReadme, new RegExp(`Current npm release: \\\`${version}\\\``));
  assert.match(changelog, new RegExp(`^## ${version} - \\d{4}-\\d{2}-\\d{2}$`, 'm'));
  assert.match(security, new RegExp(`supported version is \\\`${version}\\\``));
  assert.match(llms, new RegExp(`Release status: published \\(\\\`${version}\\\` is available`));
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
