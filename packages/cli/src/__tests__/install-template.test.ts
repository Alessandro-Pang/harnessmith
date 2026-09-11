import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { parse } from 'yaml';
import { parseFrontmatterDocument } from '../../../../packages/harness/src/lib/documentation/frontmatter.js';
import { render as renderHarnessTemplate } from '../../../../packages/harness/src/lib/filesystem/templates.js';
import type { Runtime } from '../../../../packages/harness/src/types.js';
import {
  installationRenderer,
  listModules,
  templateRoot,
} from '../installation/install-template.js';
import type { Hub } from '../shared/types.js';

function windowsHub(home: string): Hub {
  const agentsHome = `${home}/.agents`;
  const hubHome = `${agentsHome}/harnessmith`;
  const harness = `${hubHome}/skills/agent-harness`;
  return {
    scope: 'hub',
    name: 'hub',
    label: 'Harness hub',
    userHome: home,
    agentsHome,
    home: hubHome,
    record: `${hubHome}/.harnessmith/install.json`,
    outputs: [],
    entry: `${hubHome}/AGENTS.md`,
    harness,
    discoveryLink: `${agentsHome}/skills/agent-harness`,
    state: `${hubHome}/state`,
    rules: `${hubHome}/rules`,
    memory: `${hubHome}/memory`,
    legacyRules: `${home}/.agent-harness`,
    legacyMemory: `${home}/.agent-docs`,
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
  const hub = windowsHub(home);
  const template = readFileSync(
    join(templateRoot, 'template', 'skills', 'agent-harness', 'docs', 'manifest.yaml'),
    'utf8',
  );

  const manifest = parse(installationRenderer(hub, {})(template)) as { root: string };

  assert.equal(manifest.root, `${hub.harness}/docs`);
});

test('renders all distributed frontmatter with valid Windows paths', () => {
  const home = String.raw`C:\Users\runneradmin\AppData\Local\Temp\host`;
  const repositoryRoot = String.raw`C:\Users\runneradmin\git-repo`;
  const hub = windowsHub(home);
  const render = installationRenderer(hub, {
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
    harnessHome: String.raw`C:\Users\runneradmin\.agents\harnessmith`,
    agentsHome: String.raw`C:\Users\runneradmin\.agents`,
    hostAdapter: 'hub',
    instructionFiles: [],
    installedHarness: String.raw`C:\Users\runneradmin\.agents\harnessmith\skills\agent-harness`,
    docsRoot: String.raw`C:\Users\runneradmin\.agents\harnessmith\skills\agent-harness\docs`,
    stateRoot: String.raw`C:\Users\runneradmin\.agents\harnessmith\state`,
    memoryHome: String.raw`C:\Users\runneradmin\.agents\harnessmith\memory`,
    personalHome: String.raw`C:\Users\runneradmin\.agents\harnessmith\rules`,
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

test('module discovery does not follow symbolic-link files outside the staged Harness', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-module-symlink-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const outside = join(root, 'outside.mjs');
  const staged = join(root, 'staged');
  mkdirSync(staged);
  writeFileSync(outside, 'export const outside = true;\n');
  symlinkSync(outside, join(staged, 'linked.mjs'), 'file');

  assert.deepEqual(listModules(staged), []);
});
