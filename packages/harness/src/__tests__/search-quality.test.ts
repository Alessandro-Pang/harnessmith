import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';
import type { SearchReport, SearchSource } from '../lib/search/search.js';
import { searchText } from '../lib/search/search.js';
import { searchWithIndex } from '../lib/search/search-index.js';
import { harnessRuntime } from './helpers/harness.js';

interface GoldenQuery {
  id: string;
  category: string;
  query: string;
  relevant: string[];
  scanMustMiss?: boolean;
  expectedFirst?: string;
}

interface GoldenFixture {
  version: number;
  description: string;
  documents: Array<{ path: string; lines: string[] }>;
  queries: GoldenQuery[];
}

function fixture(): GoldenFixture {
  const path = fileURLToPath(new URL('./fixtures/search-golden-v1.json', import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as GoldenFixture;
}

function resultPaths(report: SearchReport, root: string, limit: number): string[] {
  return [
    ...new Set(
      report.matches.slice(0, limit).map(({ path }) => relative(root, path).replaceAll('\\', '/')),
    ),
  ];
}

function recallAt(report: SearchReport, root: string, query: GoldenQuery, limit: number): number {
  const paths = new Set(resultPaths(report, root, limit));
  return query.relevant.filter((path) => paths.has(path)).length / query.relevant.length;
}

function precisionAt(
  report: SearchReport,
  root: string,
  query: GoldenQuery,
  limit: number,
): number {
  const paths = resultPaths(report, root, limit);
  if (paths.length === 0) return 0;
  const relevant = new Set(query.relevant);
  return paths.filter((path) => relevant.has(path)).length / paths.length;
}

test('versioned golden queries improve recall without exact technical identifier regressions', () => {
  const golden = fixture();
  assert.equal(golden.version, 2);
  assert.match(golden.description, /versioned.*retrieval/i);
  const root = mkdtempSync(join(tmpdir(), 'harness-search-quality-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const docs = join(root, 'docs');
  mkdirSync(docs);
  for (const document of golden.documents) {
    const path = join(docs, document.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${document.lines.join('\n')}\n`);
  }
  const runtime = harnessRuntime(root);
  const sources: SearchSource[] = [{ root: docs, label: 'golden', trust: 'untrusted' }];
  searchWithIndex(runtime, golden.queries[0].query, sources, { refreshIndex: true });

  let scanRecall5 = 0;
  let fulltextRecall5 = 0;
  let fulltextRecall10 = 0;
  for (const query of golden.queries) {
    const scan = searchText(query.query, sources, { limit: 50 });
    const fulltext = searchWithIndex(runtime, query.query, sources, {
      mode: 'fulltext',
      limit: 50,
    });
    const scanAt5 = recallAt(scan, docs, query, 5);
    const indexedAt5 = recallAt(fulltext, docs, query, 5);
    const indexedAt10 = recallAt(fulltext, docs, query, 10);
    scanRecall5 += scanAt5;
    fulltextRecall5 += indexedAt5;
    fulltextRecall10 += indexedAt10;
    assert.equal(indexedAt5, 1, `${query.id} should retrieve every relevant document in Top-5`);
    assert.equal(indexedAt10, 1, `${query.id} should retrieve every relevant document in Top-10`);
    if (query.scanMustMiss) assert.equal(scanAt5, 0, `${query.id} must demonstrate recall gain`);
    if (query.expectedFirst) {
      assert.equal(resultPaths(fulltext, docs, 1)[0], query.expectedFirst, query.id);
    }
    if (query.category === 'exact-technical') {
      assert.equal(resultPaths(fulltext, docs, 1)[0], query.relevant[0], `${query.id} Top-1`);
      assert.ok(indexedAt5 >= scanAt5, `${query.id} exact retrieval must not regress`);
      assert.ok(
        precisionAt(fulltext, docs, query, 5) >= precisionAt(scan, docs, query, 5),
        `${query.id} exact precision must not regress`,
      );
    }
  }

  const queryCount = golden.queries.length;
  assert.ok(fulltextRecall5 / queryCount > scanRecall5 / queryCount);
  assert.equal(fulltextRecall10 / queryCount, 1);
});
