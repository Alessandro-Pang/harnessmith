import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('raw HTML anchors in site content carry the base prefix', () => {
  const markdownFiles = readdirSync(join(root, 'apps', 'docs', 'site'), { recursive: true })
    .map(String)
    .filter((path) => path.endsWith('.md'));

  assert.ok(markdownFiles.length > 0, 'site markdown files must be discovered');

  for (const path of markdownFiles) {
    const content = readFileSync(join(root, 'apps', 'docs', 'site', path), 'utf8');
    // VitePress base-prefixes Markdown links only; raw HTML hrefs must spell out /harnessmith/,
    // otherwise they navigate away from the Pages base path and 404 in production.
    assert.doesNotMatch(
      content,
      /<a href="\/(?!harnessmith\/)/,
      `${path} has a root-relative raw HTML anchor without the /harnessmith/ base prefix`,
    );
  }
});
