import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import type { SearchSource } from '../lib/search/search.js';
import {
  searchCorpusDigest,
  serializeSearchIndexSnapshot,
} from '../lib/search/search-index-snapshot.js';
import { queryLoadedIndex, searchIndexPath, searchWithIndex } from '../lib/search/search-index.js';
import { loadCurrentIndex } from '../lib/search/search-index-store.js';
import { assertMode, capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(): {
  root: string;
  docs: string;
  runtime: ReturnType<typeof harnessRuntime>;
  sources: SearchSource[];
} {
  const root = mkdtempSync(join(tmpdir(), 'harness-search-index-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const docs = join(root, 'docs');
  mkdirSync(docs, { recursive: true });
  return {
    root,
    docs,
    runtime: harnessRuntime(root),
    sources: [{ root: docs, label: 'docs', trust: 'guidance' }],
  };
}

test('auto mode preserves bounded scan fallback while fulltext mode is strict', () => {
  const { docs, runtime, sources } = fixture();
  writeFileSync(join(docs, 'guide.md'), '# Guide\n\nscan fallback needle\n');

  const automatic = searchWithIndex(runtime, 'needle', sources);
  assert.equal(automatic.matches.length, 1);
  assert.deepEqual(automatic.retrieval, {
    requestedMode: 'auto',
    usedMode: 'scan',
    indexStatus: 'missing',
    scopeHash: automatic.retrieval?.scopeHash,
    fallbackReason: 'Search index is missing',
  });
  assert.throws(
    () => searchWithIndex(runtime, 'needle', sources, { mode: 'fulltext' }),
    /index is missing.*refresh-index/i,
  );
});

test('refresh builds a private persisted index with Chinese and technical-token retrieval', () => {
  const { docs, runtime, sources } = fixture();
  writeFileSync(
    join(docs, 'architecture.md'),
    [
      '---',
      'title: 轻量混合检索',
      'aliases: [retrieval engine]',
      '---',
      '',
      '# Search Architecture',
      '',
      'The targetOrigin and AGENTS.md contracts use capture-input.',
      '',
      '## 排序',
      '',
      '中文检索保持稳定。',
      '',
    ].join('\n'),
  );

  const chinese = searchWithIndex(runtime, '混合检索', sources, { refreshIndex: true });
  assert.equal(chinese.retrieval?.usedMode, 'fulltext');
  assert.equal(chinese.retrieval?.indexStatus, 'refreshed');
  assert.ok(chinese.matches.length > 0);

  for (const query of ['targetOrigin', 'AGENTS.md', 'capture-input', 'retrievel']) {
    const report = searchWithIndex(runtime, query, sources, { mode: 'fulltext' });
    assert.ok(report.matches.length > 0, `expected indexed match for ${query}`);
  }

  const path = searchIndexPath(runtime, sources);
  assertMode(path, 0o600);
  const snapshot = JSON.parse(readFileSync(path, 'utf8')) as {
    index: { storedFields: Record<string, Record<string, unknown>> };
  };
  for (const fields of Object.values(snapshot.index.storedFields)) {
    assert.equal(Object.hasOwn(fields, 'body'), false);
    assert.deepEqual(Object.keys(fields).sort(), ['lineEnd', 'lineStart', 'path', 'sourceIndex']);
  }
});

test('refresh updates changed chunks incrementally and removes deleted documents', () => {
  const { docs, runtime, sources } = fixture();
  const changed = join(docs, 'changed.md');
  const stable = join(docs, 'stable.md');
  writeFileSync(changed, '# Changed\n\nobsoleteword\n');
  writeFileSync(stable, '# Stable\n\nstablemarker\n');
  searchWithIndex(runtime, 'obsoleteword', sources, { refreshIndex: true });
  const path = searchIndexPath(runtime, sources);
  const before = JSON.parse(readFileSync(path, 'utf8')) as {
    files: Array<{ relativePath: string; chunkIds: string[]; contentDigest: string }>;
  };

  writeFileSync(changed, '# Changed\n\nreplacementword\n');
  const updated = searchWithIndex(runtime, 'replacementword', sources, { refreshIndex: true });
  assert.ok(updated.matches.length > 0);
  assert.equal(
    searchWithIndex(runtime, 'obsoleteword', sources, { mode: 'fulltext' }).matches.length,
    0,
  );
  const after = JSON.parse(readFileSync(path, 'utf8')) as typeof before;
  const stableBefore = before.files.find((file) => file.relativePath === 'stable.md');
  const stableAfter = after.files.find((file) => file.relativePath === 'stable.md');
  const changedBefore = before.files.find((file) => file.relativePath === 'changed.md');
  const changedAfter = after.files.find((file) => file.relativePath === 'changed.md');
  assert.deepEqual(stableAfter, stableBefore);
  assert.deepEqual(changedAfter?.chunkIds, changedBefore?.chunkIds);
  assert.notEqual(changedAfter?.contentDigest, changedBefore?.contentDigest);

  rmSync(stable);
  searchWithIndex(runtime, 'replacementword', sources, { refreshIndex: true });
  assert.equal(
    searchWithIndex(runtime, 'stablemarker', sources, { mode: 'fulltext' }).matches.length,
    0,
  );
});

test('refresh rejects an index that exceeds its chunk budget', () => {
  const { docs, runtime, sources } = fixture();
  writeFileSync(join(docs, 'large.md'), `# Large\n\n${'x'.repeat(16_001)}\n`);

  assert.throws(
    () => searchWithIndex(runtime, 'large', sources, { refreshIndex: true, maxChunks: 1 }),
    /chunk budget/i,
  );
  assert.equal(existsSync(searchIndexPath(runtime, sources)), false);
});

test('stale and corrupt indexes fail closed or fall back according to mode', () => {
  const { docs, runtime, sources } = fixture();
  const guide = join(docs, 'guide.md');
  writeFileSync(guide, '# Guide\n\nfirst version\n');
  searchWithIndex(runtime, 'first', sources, { refreshIndex: true });

  writeFileSync(guide, '# Guide\n\nsecond version\n');
  const stale = searchWithIndex(runtime, 'second', sources);
  assert.equal(stale.retrieval?.usedMode, 'scan');
  assert.equal(stale.retrieval?.indexStatus, 'stale');
  assert.throws(
    () => searchWithIndex(runtime, 'second', sources, { mode: 'fulltext' }),
    /index is stale/i,
  );

  searchWithIndex(runtime, 'second', sources, { refreshIndex: true });
  const path = searchIndexPath(runtime, sources);
  writeFileSync(path, '{broken');
  chmodSync(path, 0o600);
  const corrupt = searchWithIndex(runtime, 'second', sources);
  assert.equal(corrupt.retrieval?.usedMode, 'scan');
  assert.equal(corrupt.retrieval?.indexStatus, 'corrupt');
  assert.equal(statSync(path).isFile(), true);
});

test('excluded directories remain outside both refresh and indexed retrieval', () => {
  const { docs, runtime } = fixture();
  mkdirSync(join(docs, '_archive'));
  writeFileSync(join(docs, 'active.md'), '# Active\n\nactiveword\n');
  writeFileSync(join(docs, '_archive', 'old.md'), '# Old\n\narchivedmarker\n');
  const sources: SearchSource[] = [
    { root: docs, label: 'memory', trust: 'untrusted', excludeDirectories: ['_archive'] },
  ];

  searchWithIndex(runtime, 'activeword', sources, { refreshIndex: true });
  const archived = searchWithIndex(runtime, 'archivedmarker', sources, { mode: 'fulltext' });
  assert.equal(archived.matches.length, 0);
});

test('field boosts and deterministic tie breakers do not use trust as relevance', () => {
  const { docs, runtime } = fixture();
  writeFileSync(join(docs, 'a.md'), '# Ranked term\n\nunrelated body\n');
  writeFileSync(join(docs, 'b.md'), '# Other\n\nranked term\n');
  const sources: SearchSource[] = [{ root: docs, label: 'docs', trust: 'untrusted' }];

  const ranked = searchWithIndex(runtime, 'ranked term', sources, { refreshIndex: true });
  assert.equal(ranked.matches[0].path, join(docs, 'a.md'));
  assert.ok(ranked.matches[0].matchedFields?.includes('title'));

  writeFileSync(join(docs, 'c.md'), '# Same\n\ntiebreakmarker\n');
  writeFileSync(join(docs, 'd.md'), '# Same\n\ntiebreakmarker\n');
  const tied = searchWithIndex(runtime, 'tiebreakmarker', sources, { refreshIndex: true });
  assert.deepEqual(
    tied.matches.slice(0, 2).map(({ path }) => path),
    [join(docs, 'c.md'), join(docs, 'd.md')],
  );
});

test('context CLI exposes refresh and strict fulltext modes through JSON retrieval metadata', () => {
  const { root, docs, runtime } = fixture();
  writeFileSync(join(docs, 'cli.md'), '# CLI\n\ncliindexedmarker\n');
  const refreshed = capturedIo();

  assert.equal(
    runCli(['search', '--project', root, '--refresh-index', '--json', 'cliindexedmarker'], {
      runtime,
      io: refreshed,
    }),
    0,
  );
  assert.equal(JSON.parse(refreshed.logs[0]).retrieval.indexStatus, 'refreshed');

  const strict = capturedIo();
  assert.equal(
    runCli(['search', '--project', root, '--mode', 'fulltext', '--json', 'cliindexedmarker'], {
      runtime,
      io: strict,
    }),
    0,
  );
  assert.equal(JSON.parse(strict.logs[0]).retrieval.usedMode, 'fulltext');
});

test('context search excludes host-evals from scan and fulltext retrieval', () => {
  const { root, docs, runtime } = fixture();
  const projectMemory = join(root, '.agent-docs');
  const hostEvals = join(projectMemory, 'host-evals');
  mkdirSync(hostEvals, { recursive: true });
  writeFileSync(join(docs, 'active.md'), '# Active\n\nactivecontextmarker\n');
  writeFileSync(join(hostEvals, 'evidence.md'), '# Evidence\n\nhostevidenceleakmarker\n');

  const scan = capturedIo();
  assert.equal(
    runCli(['search', '--project', root, '--mode', 'scan', '--json', 'hostevidenceleakmarker'], {
      runtime,
      io: scan,
    }),
    1,
  );
  assert.equal(JSON.parse(scan.logs[0]).matches.length, 0);

  assert.equal(
    runCli(['search', '--project', root, '--refresh-index', '--json', 'activecontextmarker'], {
      runtime,
      io: capturedIo(),
    }),
    0,
  );
  const fulltext = capturedIo();
  assert.equal(
    runCli(
      ['search', '--project', root, '--mode', 'fulltext', '--json', 'hostevidenceleakmarker'],
      { runtime, io: fulltext },
    ),
    1,
  );
  assert.equal(JSON.parse(fulltext.logs[0]).matches.length, 0);
});

test('index validation distinguishes malformed, unsupported, and backend-corrupt caches', () => {
  const { docs, runtime, sources } = fixture();
  writeFileSync(join(docs, 'guide.md'), '# Guide\n\nvalidationmarker\n');
  searchWithIndex(runtime, 'validationmarker', sources, { refreshIndex: true });
  const path = searchIndexPath(runtime, sources);

  writeFileSync(path, '{}');
  assert.equal(
    searchWithIndex(runtime, 'validationmarker', sources).retrieval?.indexStatus,
    'corrupt',
  );

  searchWithIndex(runtime, 'validationmarker', sources, { refreshIndex: true });
  const unsupported = JSON.parse(readFileSync(path, 'utf8'));
  unsupported.backend.version = 'unsupported-test-version';
  writeFileSync(path, JSON.stringify(unsupported));
  assert.equal(
    searchWithIndex(runtime, 'validationmarker', sources).retrieval?.indexStatus,
    'unsupported',
  );

  searchWithIndex(runtime, 'validationmarker', sources, { refreshIndex: true });
  const backendCorrupt = JSON.parse(readFileSync(path, 'utf8'));
  backendCorrupt.index = {};
  writeFileSync(path, JSON.stringify(backendCorrupt));
  assert.equal(
    searchWithIndex(runtime, 'validationmarker', sources).retrieval?.indexStatus,
    'corrupt',
  );
  assert.doesNotThrow(() =>
    searchWithIndex(runtime, 'validationmarker', sources, { refreshIndex: true }),
  );

  const postingCorrupt = JSON.parse(readFileSync(path, 'utf8'));
  postingCorrupt.index.index = postingCorrupt.index.index.filter(
    ([term]: [string]) => term !== 'validationmarker',
  );
  writeFileSync(path, JSON.stringify(postingCorrupt));
  assert.equal(
    searchWithIndex(runtime, 'validationmarker', sources).retrieval?.indexStatus,
    'corrupt',
  );

  searchWithIndex(runtime, 'validationmarker', sources, { refreshIndex: true });
  const inventoryCorrupt = JSON.parse(readFileSync(path, 'utf8'));
  inventoryCorrupt.files[0].chunkIds = [];
  inventoryCorrupt.corpusDigest = searchCorpusDigest(inventoryCorrupt.files);
  writeFileSync(path, JSON.stringify(inventoryCorrupt));
  assert.equal(
    searchWithIndex(runtime, 'validationmarker', sources).retrieval?.indexStatus,
    'corrupt',
  );

  const validSnapshot = JSON.parse(readFileSync(path, 'utf8'));
  assert.throws(() => serializeSearchIndexSnapshot(validSnapshot, 100), /serialized byte budget/i);
});

test('refresh and snippet budgets remain bounded independently of result limits', () => {
  const { docs, runtime, sources } = fixture();
  writeFileSync(join(docs, 'guide.md'), '# Guide\n\nbudgetmarker\n');

  assert.throws(
    () =>
      searchWithIndex(runtime, 'budgetmarker', sources, { refreshIndex: true, maxFileBytes: 1 }),
    /per-file byte budget/i,
  );
  assert.throws(
    () =>
      searchWithIndex(runtime, 'budgetmarker', sources, {
        refreshIndex: true,
        maxFileBytes: 1024,
        maxTotalBytes: 1,
      }),
    /total byte budget/i,
  );

  searchWithIndex(runtime, 'budgetmarker', sources, { refreshIndex: true });
  assert.throws(
    () =>
      searchWithIndex(runtime, 'budgetmarker', sources, {
        mode: 'fulltext',
        maxTotalBytes: 1,
      }),
    /index is stale/i,
  );
  assert.throws(
    () => searchWithIndex(runtime, 'budgetmarker', sources, { mode: 'scan', refreshIndex: true }),
    /cannot be combined/i,
  );
  assert.equal(
    searchWithIndex(runtime, 'budgetmarker', sources, { mode: 'scan' }).retrieval?.indexStatus,
    'not-requested',
  );

  writeFileSync(join(docs, 'second.md'), '# Second\n');
  assert.throws(
    () => searchWithIndex(runtime, 'budgetmarker', sources, { refreshIndex: true, maxFiles: 1 }),
    /source-discovery budget/i,
  );
});

test('inventory additions invalidate strict queries and identical rewrites reuse chunks', () => {
  const { docs, runtime, sources } = fixture();
  const stable = join(docs, 'stable.md');
  const content = '# Stable\n\nidentitymarker\n';
  writeFileSync(stable, content);
  searchWithIndex(runtime, 'identitymarker', sources, { refreshIndex: true });
  const path = searchIndexPath(runtime, sources);
  const before = JSON.parse(readFileSync(path, 'utf8'));

  writeFileSync(stable, content);
  searchWithIndex(runtime, 'identitymarker', sources, { refreshIndex: true });
  const after = JSON.parse(readFileSync(path, 'utf8'));
  assert.deepEqual(after.files[0].chunkIds, before.files[0].chunkIds);
  assert.equal(after.files[0].contentDigest, before.files[0].contentDigest);

  writeFileSync(join(docs, 'added.md'), '# Added\n');
  assert.throws(
    () => searchWithIndex(runtime, 'identitymarker', sources, { mode: 'fulltext' }),
    /index is stale/i,
  );
});

test('refresh refuses to persist documents containing high-confidence secrets', () => {
  const { docs, runtime, sources } = fixture();
  const generatedSecret = `ghp_${'A'.repeat(24)}`;
  writeFileSync(join(docs, 'unsafe.md'), `# Unsafe\n\n${generatedSecret}\n`);

  assert.throws(
    () => searchWithIndex(runtime, 'unsafe', sources, { refreshIndex: true }),
    /high-confidence secret material/i,
  );
  assert.equal(existsSync(searchIndexPath(runtime, sources)), false);

  rmSync(join(docs, 'unsafe.md'));
  writeFileSync(join(docs, `${generatedSecret}.md`), '# Safe\n');
  assert.throws(
    () => searchWithIndex(runtime, 'safe', sources, { refreshIndex: true }),
    /high-confidence secret material/i,
  );
  assert.equal(existsSync(searchIndexPath(runtime, sources)), false);
});

test('empty corpus produces zero matches in all modes without errors', () => {
  const { runtime, sources } = fixture();

  const auto = searchWithIndex(runtime, 'anything', sources);
  assert.equal(auto.matches.length, 0);
  assert.equal(auto.retrieval?.usedMode, 'scan');

  const scan = searchWithIndex(runtime, 'anything', sources, { mode: 'scan' });
  assert.equal(scan.matches.length, 0);

  searchWithIndex(runtime, 'anything', sources, { refreshIndex: true });
  const fulltext = searchWithIndex(runtime, 'anything', sources, { mode: 'fulltext' });
  assert.equal(fulltext.matches.length, 0);
  assert.equal(fulltext.retrieval?.usedMode, 'fulltext');
});

test('querying a loaded index does not mutate the original discovery stats', () => {
  const { docs, runtime, sources } = fixture();
  writeFileSync(join(docs, 'a.md'), '# A\n\nstatsmarker\n');
  writeFileSync(join(docs, 'b.md'), '# B\n\nstatsmarker\n');
  searchWithIndex(runtime, 'statsmarker', sources, { refreshIndex: true });

  const loaded = loadCurrentIndex(runtime, sources, {});
  const statsBefore = structuredClone(loaded.discovery.stats);
  const report = queryLoadedIndex('statsmarker', sources, loaded, {});
  assert.deepEqual(loaded.discovery.stats, statsBefore);
  assert.equal(report.scanStats.filesRead, statsBefore.filesRead + 2);
});
