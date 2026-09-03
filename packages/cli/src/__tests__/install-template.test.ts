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
import type { Adapter } from '../shared/types.js';

function markdownFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && path.endsWith('.md') ? [path] : [];
  });
}

test('renders the apps/docs/site manifest with a valid Windows path', () => {
  const home = String.raw`C:\Users\runneradmin\AppData\Local\Temp\host`;
  const adapter = {
    name: 'codex',
    label: 'Codex',
    home,
    harness: `${home}/agent-harness`,
    record: `${home}/.harnessmith/install.json`,
    capabilities: {
      scope: 'global',
      instructionFormat: 'markdown',
      nativeRuleActivation: 'host-default',
      enforcement: {
        fileOwnership: 'harnessmith',
        instructions: 'advisory',
        permissions: 'host-owned',
      },
    },
    instructions: [],
  } satisfies Adapter;
  const template = readFileSync(
    join(templateRoot, 'template', 'agent-harness', 'docs', 'manifest.yaml'),
    'utf8',
  );

  const manifest = parse(installationRenderer(adapter, {})(template)) as { root: string };

  assert.equal(manifest.root, `${home}/agent-harness/docs`);
});

test('renders all distributed frontmatter with valid Windows paths', () => {
  const home = String.raw`C:\Users\runneradmin\AppData\Local\Temp\host`;
  const repositoryRoot = String.raw`C:\Users\runneradmin\git-repo`;
  const adapter = {
    name: 'codex',
    label: 'Codex',
    home,
    harness: `${home}/agent-harness`,
    record: `${home}/.harnessmith/install.json`,
    capabilities: {
      scope: 'global',
      instructionFormat: 'markdown',
      nativeRuleActivation: 'host-default',
      enforcement: {
        fileOwnership: 'harnessmith',
        instructions: 'advisory',
        permissions: 'host-owned',
      },
    },
    instructions: [],
  } satisfies Adapter;
  const render = installationRenderer(adapter, {
    HARNESS_REPOSITORY_ROOT: repositoryRoot,
  });
  const docsRoot = join(templateRoot, 'template', 'agent-harness', 'docs');

  for (const path of markdownFiles(docsRoot)) {
    assert.doesNotThrow(
      () => parseFrontmatterDocument(render(readFileSync(path, 'utf8'), path)),
      path,
    );
  }
});

test('renders all memory template frontmatter with YAML-safe values', () => {
  const home = String.raw`C:\Users\runneradmin`;
  const harnessRoot = join(templateRoot, 'template', 'agent-harness');
  const runtime = {
    env: { HOME: home, TZ: 'UTC' },
    home,
    harnessRoot,
    distributionRoot: templateRoot,
    harnessHome: String.raw`C:\Users\runneradmin\host`,
    hostAdapter: 'test',
    instructionFiles: [],
    installedHarness: String.raw`C:\Users\runneradmin\host\agent-harness`,
    docsRoot: String.raw`C:\Users\runneradmin\host\agent-harness\docs`,
    memoryHome: String.raw`C:\Users\runneradmin\.agent-docs`,
    personalHome: String.raw`C:\Users\runneradmin\.agent-harness`,
    repositoryRoot: String.raw`C:\Users\runneradmin\git-repo`,
    owner: String.raw`DOMAIN\runneradmin`,
  } satisfies Runtime;
  const templatesRoot = join(harnessRoot, 'templates');

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
