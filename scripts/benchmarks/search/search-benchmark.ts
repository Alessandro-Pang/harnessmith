import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { SearchSource } from '../../../template/agent-harness/src/lib/search/search.js';
import { searchBackend } from '../../../template/agent-harness/src/lib/search/search-backend.js';
import {
  searchIndexPath,
  searchWithIndex,
} from '../../../template/agent-harness/src/lib/search/search-index.js';
import { loadCurrentIndex } from '../../../template/agent-harness/src/lib/search/search-index-store.js';
import type { Runtime } from '../../../template/agent-harness/src/types.js';

interface BenchmarkResult {
  documents: number;
  files: number;
  buildMs: number;
  incrementalUpdateMs: number;
  restoreMs: number;
  warmQueryP50Ms: number;
  warmQueryP95Ms: number;
  commonQueryP95Ms: number;
  fuzzyQueryP95Ms: number;
  retainedHeapMiB: number;
  observedHeapPeakMiB: number;
  serializedIndexMiB: number;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} is out of range`);
  return parsed;
}

function benchmarkSizes(): number[] {
  return (option('--sizes') || '1000,10000,50000')
    .split(',')
    .map((value) => positiveInteger(value, 0, 'Benchmark size'));
}

function fixtureRuntime(root: string): Runtime {
  const installedHarness = join(root, 'host', 'agent-harness');
  mkdirSync(installedHarness, { recursive: true });
  return {
    env: { HOME: join(root, 'home'), TZ: 'UTC' },
    home: join(root, 'home'),
    harnessRoot: join(root, 'source'),
    distributionRoot: join(root, 'distribution'),
    harnessHome: join(root, 'host'),
    hostAdapter: 'test',
    instructionFiles: [join(root, 'host', 'AGENTS.md')],
    installedHarness,
    docsRoot: join(installedHarness, 'docs'),
    memoryHome: join(root, 'memory'),
    personalHome: join(root, 'personal'),
    repositoryRoot: join(root, 'repositories'),
    owner: 'benchmark',
    identityOverride: 'test-fixture',
  };
}

function generateCorpus(root: string, documents: number, chunksPerFile: number): number {
  const files = Math.ceil(documents / chunksPerFile);
  for (let fileIndex = 0; fileIndex < files; fileIndex += 1) {
    const sections: string[] = ['---', `title: Search corpus ${fileIndex}`, '---', ''];
    for (let offset = 0; offset < chunksPerFile; offset += 1) {
      const documentIndex = fileIndex * chunksPerFile + offset;
      if (documentIndex >= documents) break;
      sections.push(
        `# Document ${documentIndex}`,
        '',
        `doc${documentIndex}unique targetOrigin AGENTS.md capture-input verification 混合检索`,
        '',
      );
    }
    writeFileSync(join(root, `${String(fileIndex).padStart(6, '0')}.md`), sections.join('\n'));
  }
  return files;
}

function percentile(samples: number[], ratio: number): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function collectGarbage(): void {
  (globalThis as typeof globalThis & { gc?: () => void }).gc?.();
}

function timedQueries(
  backend: ReturnType<typeof loadCurrentIndex>['backend'],
  query: string,
  iterations: number,
): number[] {
  const samples: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const started = performance.now();
    searchBackend(backend, query);
    samples.push(performance.now() - started);
  }
  return samples;
}

function runSize(documents: number, iterations: number, chunksPerFile: number): BenchmarkResult {
  const root = mkdtempSync(join(tmpdir(), `harness-search-benchmark-${documents}-`));
  try {
    const docs = join(root, 'docs');
    mkdirSync(docs);
    const files = generateCorpus(docs, documents, chunksPerFile);
    const runtime = fixtureRuntime(root);
    const sources: SearchSource[] = [{ root: docs, label: 'benchmark', trust: 'guidance' }];
    const query = `doc${documents - 1}unique`;
    const options = {
      maxEntries: files + 10,
      maxFiles: files + 10,
      maxTotalBytes: 512 * 1024 * 1024,
      maxDurationMs: 300_000,
    };
    collectGarbage();
    const baselineHeap = process.memoryUsage().heapUsed;
    const observedHeap = [baselineHeap];
    const buildStarted = performance.now();
    searchWithIndex(runtime, query, sources, { ...options, refreshIndex: true });
    const buildMs = performance.now() - buildStarted;
    observedHeap.push(process.memoryUsage().heapUsed);

    appendFileSync(join(docs, '000000.md'), '\n\nincrementalbenchmarkmarker\n');
    const incrementalStarted = performance.now();
    searchWithIndex(runtime, 'incrementalbenchmarkmarker', sources, {
      ...options,
      refreshIndex: true,
    });
    const incrementalUpdateMs = performance.now() - incrementalStarted;
    observedHeap.push(process.memoryUsage().heapUsed);
    collectGarbage();

    const restoreStarted = performance.now();
    const loaded = loadCurrentIndex(runtime, sources, options);
    const restoreMs = performance.now() - restoreStarted;
    observedHeap.push(process.memoryUsage().heapUsed);
    collectGarbage();
    const querySamples = timedQueries(loaded.backend, query, iterations);
    const commonQuerySamples = timedQueries(loaded.backend, 'capture-input', iterations);
    const fuzzyQuerySamples = timedQueries(loaded.backend, 'verfication', iterations);
    observedHeap.push(process.memoryUsage().heapUsed);
    collectGarbage();
    const retainedHeap = process.memoryUsage().heapUsed;
    return {
      documents,
      files,
      buildMs,
      incrementalUpdateMs,
      restoreMs,
      warmQueryP50Ms: percentile(querySamples, 0.5),
      warmQueryP95Ms: percentile(querySamples, 0.95),
      commonQueryP95Ms: percentile(commonQuerySamples, 0.95),
      fuzzyQueryP95Ms: percentile(fuzzyQuerySamples, 0.95),
      retainedHeapMiB: Math.max(0, retainedHeap - baselineHeap) / 1024 / 1024,
      observedHeapPeakMiB: (Math.max(...observedHeap) - baselineHeap) / 1024 / 1024,
      serializedIndexMiB: statSync(searchIndexPath(runtime, sources)).size / 1024 / 1024,
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const iterations = positiveInteger(option('--iterations'), 100, 'Iterations');
const chunksPerFile = positiveInteger(option('--chunks-per-file'), 10, 'Chunks per file');
const results = benchmarkSizes().map((size) => runSize(size, iterations, chunksPerFile));
const bundlePath = join('template', 'agent-harness', 'dist', 'harness.mjs');
console.log(
  JSON.stringify(
    {
      version: 2,
      environment: { node: process.version, platform: process.platform, arch: process.arch },
      iterations,
      chunksPerFile,
      bundleMiB: existsSync(bundlePath) ? statSync(bundlePath).size / 1024 / 1024 : null,
      results,
    },
    null,
    2,
  ),
);
