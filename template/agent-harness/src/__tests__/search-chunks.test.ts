import assert from 'node:assert/strict';
import { test } from 'vitest';
import { chunkSearchDocument } from '../lib/search-chunks.js';
import { tokenizeSearchText } from '../lib/search-tokenizer.js';

test('Markdown chunks preserve frontmatter title, heading lineage, and source lines', () => {
  const content = [
    '---',
    'title: Indexed Guide',
    'aliases: [search handbook]',
    '---',
    '',
    '# Root',
    'alpha body',
    '## Child',
    'beta body',
    '',
  ].join('\n');
  const chunks = chunkSearchDocument({ content, relativePath: 'guide.md', sourceIndex: 0 });

  assert.deepEqual(
    chunks.map(({ title, aliases, headings, lineStart, lineEnd, body }) => ({
      title,
      aliases,
      headings,
      lineStart,
      lineEnd,
      body,
    })),
    [
      {
        title: 'Indexed Guide',
        aliases: 'search handbook',
        headings: 'Root',
        lineStart: 6,
        lineEnd: 7,
        body: '# Root\nalpha body',
      },
      {
        title: 'Indexed Guide',
        aliases: 'search handbook',
        headings: 'Root > Child',
        lineStart: 8,
        lineEnd: 10,
        body: '## Child\nbeta body\n',
      },
    ],
  );
});

test('chunk IDs stay stable across body edits but distinguish repeated headings', () => {
  const before = chunkSearchDocument({
    content: '# Same\nfirst\n# Same\nsecond\n',
    relativePath: 'repeat.md',
    sourceIndex: 2,
  });
  const after = chunkSearchDocument({
    content: '# Same\nchanged\n# Same\nsecond\n',
    relativePath: 'repeat.md',
    sourceIndex: 2,
  });

  assert.deepEqual(
    after.map(({ id }) => id),
    before.map(({ id }) => id),
  );
  assert.notEqual(before[0].id, before[1].id);
});

test('tokenizer keeps technical identifiers and adds Chinese bigrams', () => {
  const tokens = tokenizeSearchText('AGENTS.md targetOrigin capture-input 混合检索');

  for (const token of [
    'agents.md',
    'agents',
    'md',
    'targetorigin',
    'target',
    'origin',
    'capture-input',
    'capture',
    'input',
    '混合',
    '合检',
    '检索',
  ]) {
    assert.ok(tokens.includes(token), `expected tokenizer output to include ${token}`);
  }
});

test('YAML documents use basename titles and deterministically split oversized lines', () => {
  const chunks = chunkSearchDocument({
    content: 'x'.repeat(16_001),
    relativePath: 'config.yaml',
    sourceIndex: 1,
  });

  assert.deepEqual(
    chunks.map(({ title, lineStart, lineEnd, body }) => ({
      title,
      lineStart,
      lineEnd,
      length: body.length,
    })),
    [
      { title: 'config', lineStart: 1, lineEnd: 1, length: 16_000 },
      { title: 'config', lineStart: 1, lineEnd: 1, length: 1 },
    ],
  );
});
