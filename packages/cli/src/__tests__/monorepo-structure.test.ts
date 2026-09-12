import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import YAML from 'yaml';

const root = process.cwd();

describe('Monorepo structure', () => {
  test('resolves the distribution root past the CLI workspace manifest without hanging', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        "import { templateRoot } from './packages/cli/src/installation/install-template.ts'; console.log(templateRoot);",
      ],
      { cwd: root, encoding: 'utf8', timeout: 5_000 },
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(root);
  });

  test('declares app and package workspace boundaries', () => {
    const workspace = YAML.parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')) as {
      packages?: string[];
    };

    expect(workspace.packages).toEqual(expect.arrayContaining(['apps/*', 'packages/*']));
  });

  test('keeps the embedded Harness as a private package boundary', () => {
    const manifest = JSON.parse(
      readFileSync(join(root, 'packages/harness/package.json'), 'utf8'),
    ) as { private?: boolean; name?: string };

    expect(manifest).toMatchObject({ name: '@harnessmith/harness', private: true });
  });

  test('publishes only the repository root and keeps workspace packages private', () => {
    const workspaceManifest = JSON.parse(
      readFileSync(join(root, 'packages/cli/package.json'), 'utf8'),
    ) as { name?: string; private?: boolean };
    const publishedManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name?: string;
      private?: boolean;
    };

    // `release-publish.ts` publishes the tarball packed from the root manifest, so a second
    // manifest claiming the same public name can only mispublish a hollow package.
    expect(publishedManifest.name).toBe('harnessmith');
    expect(publishedManifest.private).not.toBe(true);
    expect(workspaceManifest).toMatchObject({ name: '@harnessmith/cli', private: true });
    expect(workspaceManifest.name).not.toBe(publishedManifest.name);
  });
});

import { spawnSync } from 'node:child_process';
