import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import YAML from 'yaml';

const root = process.cwd();

describe('Monorepo structure', () => {
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

  test('keeps the public CLI as the publishable workspace package', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')) as {
      name?: string;
      private?: boolean;
    };

    expect(manifest).toMatchObject({ name: 'harnessmith', private: false });
  });
});
