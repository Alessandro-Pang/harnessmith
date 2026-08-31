import { performance } from 'node:perf_hooks';
import { basename } from 'node:path';
import { build as bundle } from 'esbuild';
import {
  digest,
  fieldBoosts,
  fuzzyDistance,
  indexedFields,
  isTechnicalQuery,
  loadHarnessCorpus,
  loadQueries,
  prefixTerm,
  repositoryRoot,
  tokenizeSearchText,
  tokenizeTechnicalSearchText,
} from './corpus.mjs';

const candidate = process.argv[2];
const size = Number(process.argv[3]);
const iterations = Number(process.argv[4]);
if (!['minisearch', 'orama'].includes(candidate)) throw new Error('Unknown candidate');
if (!Number.isSafeInteger(size) || size <= 0) throw new Error('Invalid size');
if (!Number.isSafeInteger(iterations) || iterations <= 0) throw new Error('Invalid iterations');

const configuration = {
  fields: indexedFields,
  boosts: fieldBoosts,
  tokenizer: 'Harness analyzer v2: NFKC, Chinese words+bigrams, preserved technical identifiers',
  minisearch: {
    version: '7.2.0',
    prefix: 'last nontechnical term only; Latin >=3 or Han >=2',
    fuzzy: 'nontechnical Latin/alphanumeric terms length >=5, distance 1',
    weights: { fuzzy: 0.35, prefix: 0.7 },
  },
  orama: {
    version: '3.1.18',
    prefix: 'exact=false for nontechnical queries',
    fuzzy: 'tolerance 1 only for fuzzy-category queries',
  },
};

function percentile(samples, ratio) {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function collectGarbage() {
  globalThis.gc?.();
}

function uniqueSources(hits, limit) {
  const result = [];
  for (const hit of hits) {
    if (!result.includes(hit.sourcePath)) result.push(hit.sourcePath);
    if (result.length === limit) break;
  }
  return result;
}

function recall(paths, relevant) {
  const found = new Set(paths);
  return relevant.filter((path) => found.has(path)).length / relevant.length;
}

async function bundleBytes(name) {
  const contents =
    name === 'minisearch'
      ? "import MiniSearch from 'minisearch'; export { MiniSearch };"
      : "export { create, insertMultiple, load, save, search, update } from '@orama/orama';";
  const result = await bundle({
    stdin: { contents, resolveDir: new URL('.', import.meta.url).pathname, sourcefile: `${name}.mjs` },
    bundle: true,
    minify: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    write: false,
  });
  return result.outputFiles.reduce((total, file) => total + file.contents.byteLength, 0);
}

async function miniSearchAdapter() {
  const { default: MiniSearch } = await import('minisearch');
  const options = {
    fields: indexedFields,
    storeFields: ['sourcePath'],
    idField: 'id',
    tokenize: tokenizeSearchText,
    processTerm: (term) => term,
    autoVacuum: false,
  };
  const query = (backend, term, category, limit = 100) => {
    const technical = isTechnicalQuery(term);
    return backend
      .search(term, {
        boost: fieldBoosts,
        tokenize: technical ? tokenizeTechnicalSearchText : tokenizeSearchText,
        prefix: technical ? false : prefixTerm,
        fuzzy: technical || category !== 'fuzzy' ? false : (value) => fuzzyDistance(value),
        maxFuzzy: 1,
        weights: { fuzzy: 0.35, prefix: 0.7 },
        combineWith: 'OR',
      })
      .slice(0, limit)
      .map((hit) => ({ sourcePath: hit.sourcePath }));
  };
  return {
    create: () => new MiniSearch(options),
    build: (backend, documents) => backend.addAll(documents),
    update: (backend, document) => backend.replace(document),
    query,
    serialize: (backend) => JSON.stringify(backend.toJSON()),
    restore: (serialized) => MiniSearch.loadJSON(serialized, options),
  };
}

async function oramaAdapter() {
  const { create, insertMultiple, load, save, search, update } = await import('@orama/orama');
  const tokenizer = {
    language: 'harness-v2',
    normalizationCache: new Map(),
    tokenize: (raw) => tokenizeSearchText(raw),
  };
  const createBackend = () =>
    create({
      schema: {
        id: 'string',
        sourcePath: 'string',
        aliases: 'string',
        title: 'string',
        headings: 'string',
        path: 'string',
        body: 'string',
      },
      components: { tokenizer },
    });
  const query = async (backend, term, category, limit = 100) => {
    const result = await search(backend, {
      term,
      properties: indexedFields,
      boost: fieldBoosts,
      exact: isTechnicalQuery(term),
      tolerance: category === 'fuzzy' ? 1 : 0,
      limit,
    });
    return result.hits.map((hit) => ({ sourcePath: hit.document.sourcePath }));
  };
  return {
    create: createBackend,
    build: (backend, documents) => insertMultiple(backend, documents, 1000),
    update: (backend, document) => update(backend, document.id, document),
    query,
    serialize: (backend) => JSON.stringify(save(backend)),
    restore: async (serialized) => {
      const backend = createBackend();
      await load(backend, JSON.parse(serialized));
      return backend;
    },
  };
}

const corpus = loadHarnessCorpus(size);
const querySet = loadQueries();
const adapter = candidate === 'minisearch' ? await miniSearchAdapter() : await oramaAdapter();
collectGarbage();
const baselineHeap = process.memoryUsage().heapUsed;
const observedHeap = [baselineHeap];

let backend = adapter.create();
const buildStarted = performance.now();
await adapter.build(backend, corpus.documents);
const buildMs = performance.now() - buildStarted;
observedHeap.push(process.memoryUsage().heapUsed);

const updated = { ...corpus.documents[0], body: `${corpus.documents[0].body}\nincremental-update` };
const incrementalStarted = performance.now();
await adapter.update(backend, updated);
const incrementalUpdateMs = performance.now() - incrementalStarted;
observedHeap.push(process.memoryUsage().heapUsed);

let serialized = adapter.serialize(backend);
const serializedIndexBytes = Buffer.byteLength(serialized);
observedHeap.push(process.memoryUsage().heapUsed);
backend = null;
collectGarbage();
const restoreStarted = performance.now();
backend = await adapter.restore(serialized);
const coldRestoreMs = performance.now() - restoreStarted;
serialized = null;
collectGarbage();
observedHeap.push(process.memoryUsage().heapUsed);

const queryResults = [];
const latencyByCategory = new Map();
for (const query of querySet.queries) {
  const samples = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const started = performance.now();
    await adapter.query(backend, query.query, query.category, 10);
    samples.push(performance.now() - started);
  }
  const categorySamples = latencyByCategory.get(query.category) || [];
  categorySamples.push(...samples);
  latencyByCategory.set(query.category, categorySamples);
}
observedHeap.push(process.memoryUsage().heapUsed);
collectGarbage();
const retainedHeapBytes = Math.max(0, process.memoryUsage().heapUsed - baselineHeap);

// Ranking quality is evaluated on the single-copy real corpus. Measuring it on
// the scaled corpus would let identical benchmark replicas crowd each other out
// of Top-N and turn the expansion strategy into a false quality regression.
const qualityCorpus = loadHarnessCorpus(corpus.baseChunks);
let qualityBackend = adapter.create();
await adapter.build(qualityBackend, qualityCorpus.documents);
for (const query of querySet.queries) {
  const hits = await adapter.query(qualityBackend, query.query, query.category);
  const top5 = uniqueSources(hits, 5);
  const top10 = uniqueSources(hits, 10);
  queryResults.push({
    id: query.id,
    category: query.category,
    top5,
    top10,
    recallAt5: recall(top5, query.relevant),
    recallAt10: recall(top10, query.relevant),
  });
}
qualityBackend = null;
collectGarbage();

const qualityByCategory = Object.fromEntries(
  [...new Set(queryResults.map(({ category }) => category))].map((category) => {
    const selected = queryResults.filter((query) => query.category === category);
    return [
      category,
      {
        meanRecallAt5: selected.reduce((sum, query) => sum + query.recallAt5, 0) / selected.length,
        meanRecallAt10: selected.reduce((sum, query) => sum + query.recallAt10, 0) / selected.length,
      },
    ];
  }),
);
const latency = Object.fromEntries(
  [...latencyByCategory].map(([category, samples]) => [
    category,
    { p50Ms: percentile(samples, 0.5), p95Ms: percentile(samples, 0.95) },
  ]),
);

console.log(
  JSON.stringify({
    candidate,
    size,
    buildMs,
    incrementalUpdateMs,
    coldRestoreMs,
    retainedHeapBytes,
    observedStagePeakHeapBytes: Math.max(0, Math.max(...observedHeap) - baselineHeap),
    serializedIndexBytes,
    bundledCandidateBytes: await bundleBytes(candidate),
    latency,
    qualityByCategory,
    queries: queryResults,
    corpus: {
      files: corpus.files,
      baseChunks: corpus.baseChunks,
      sourceDigest: corpus.sourceDigest,
      corpusDigest: corpus.corpusDigest,
      construction: corpus.construction,
    },
    qualityCorpus: {
      documents: qualityCorpus.documents.length,
      corpusDigest: qualityCorpus.corpusDigest,
      construction: 'One copy of every real Harness documentation chunk; no scale replicas.',
    },
    querySet: { version: querySet.version, digest: querySet.digest },
    configuration,
    configurationDigest: digest(JSON.stringify(configuration)),
    repositoryCommit: process.env.BENCHMARK_COMMIT || null,
    repositoryRoot: basename(repositoryRoot),
  }),
);
