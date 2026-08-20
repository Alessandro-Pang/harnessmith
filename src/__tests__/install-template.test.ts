import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { parse } from 'yaml';
import { installationRenderer, templateRoot } from '../install-template.js';
import type { Adapter } from '../types.js';

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
