import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { parse } from 'yaml';
import { parseFrontmatterDocument } from '../../../../packages/harness/src/lib/documentation/frontmatter.js';
import { render as renderHarnessTemplate } from '../../../../packages/harness/src/lib/filesystem/templates.js';
import type { Runtime } from '../../../../packages/harness/src/types.js';
import { installationRenderer, templateRoot } from '../installation/install-template.js';
import type { UserDataPaths } from '../shared/types.js';

function windowsUserData(userHome: string): UserDataPaths {
  const home = `${userHome}/.harnessmith`;
  return {
    home,
    userHome,
    state: `${home}/state`,
    rules: `${home}/rules`,
    memory: `${home}/memory`,
  };
}

function markdownFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && path.endsWith('.md') ? [path] : [];
  });
}

test('renders the apps/docs/site manifest with a valid Windows path', () => {
  const home = String.raw`C:\Users\runneradmin\AppData\Local\Temp\host`;
  const userData = windowsUserData(home);
  const template = readFileSync(
    join(templateRoot, 'template', 'skills', 'agent-harness', 'docs', 'manifest.yaml'),
    'utf8',
  );

  const manifest = parse(installationRenderer(userData, {})(template)) as { root: string };

  assert.equal(manifest.root, 'docs');
});

test('renders all distributed frontmatter with valid Windows paths', () => {
  const home = String.raw`C:\Users\runneradmin\AppData\Local\Temp\host`;
  const repositoryRoot = String.raw`C:\Users\runneradmin\git-repo`;
  const userData = windowsUserData(home);
  const render = installationRenderer(userData, {
    HARNESS_REPOSITORY_ROOT: repositoryRoot,
  });
  const docsRoot = join(templateRoot, 'template', 'skills', 'agent-harness', 'docs');

  for (const path of markdownFiles(docsRoot)) {
    assert.doesNotThrow(
      () => parseFrontmatterDocument(render(readFileSync(path, 'utf8'), path)),
      path,
    );
  }
});

test('renders all memory template frontmatter with YAML-safe values', () => {
  const home = String.raw`C:\Users\runneradmin`;
  const harnessRoot = join(templateRoot, 'template', 'skills', 'agent-harness');
  const runtime = {
    env: { HOME: home, TZ: 'UTC' },
    home,
    harnessRoot,
    distributionRoot: templateRoot,
    harnessHome: String.raw`C:\Users\runneradmin\.harnessmith`,
    hostAdapter: 'codex',
    installedHarness: String.raw`C:\Users\runneradmin\.agents\skills\agent-harness`,
    docsRoot: String.raw`C:\Users\runneradmin\.agents\skills\agent-harness\docs`,
    stateRoot: String.raw`C:\Users\runneradmin\.harnessmith\state`,
    memoryHome: String.raw`C:\Users\runneradmin\.harnessmith\memory`,
    personalHome: String.raw`C:\Users\runneradmin\.harnessmith\rules`,
    repositoryRoot: String.raw`C:\Users\runneradmin\git-repo`,
    owner: String.raw`DOMAIN\runneradmin`,
  } satisfies Runtime;
  const templatesRoot = join(harnessRoot, 'assets', 'templates');

  for (const path of markdownFiles(templatesRoot)) {
    const rendered = renderHarnessTemplate(runtime, readFileSync(path, 'utf8'), {
      PROJECT_KEY: 'project "quoted"',
    });
    assert.doesNotThrow(() => parseFrontmatterDocument(rendered), path);
  }
});

test('the distributed skill contains no Runtime copy or executable shim', () => {
  const skillRoot = join(templateRoot, 'template', 'skills', 'agent-harness');
  const entries = readdirSync(skillRoot);
  assert.equal(entries.includes('scripts'), false);
  assert.equal(entries.includes('dist'), false);
});
