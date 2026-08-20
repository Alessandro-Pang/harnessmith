import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { parse } from 'yaml';
import { render as renderHarnessTemplate } from '../../template/agent-harness/src/lib/templates.js';
import type { Runtime } from '../../template/agent-harness/src/types.js';
import { installationRenderer, templateRoot } from '../install-template.js';
import type { Adapter } from '../types.js';

function markdownFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return entry.isFile() && path.endsWith('.md') ? [path] : [];
  });
}

function parseFrontmatter(content: string): unknown {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return match ? parse(match[1]) : null;
}

test('renders the docs manifest with a valid Windows path', () => {
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
    join(templateRoot, 'agent-harness', 'docs', 'manifest.yaml'),
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
  const docsRoot = join(templateRoot, 'agent-harness', 'docs');

  for (const path of markdownFiles(docsRoot)) {
    assert.doesNotThrow(() => parseFrontmatter(render(readFileSync(path, 'utf8'), path)), path);
  }
});

test('renders all memory template frontmatter with YAML-safe values', () => {
  const home = String.raw`C:\Users\runneradmin`;
  const harnessRoot = join(templateRoot, 'agent-harness');
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
    assert.doesNotThrow(() => parseFrontmatter(rendered), path);
  }
});
