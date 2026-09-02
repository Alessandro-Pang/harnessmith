import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AnySchema } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { benchmarkMetrics, evaluateCorpus } from './prompt-route-benchmark-evaluate.js';
import type {
  PromptRouteBenchmarkComparison,
  PromptRouteBenchmarkReport,
  PromptRouteCorpus,
} from './prompt-route-benchmark-types.js';

export const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const corpusRelative = 'evals/prompt-route-corpus.v1.json';
const schemaRelative = 'evals/prompt-route-corpus.schema.json';
const rulesSources = [
  'template/AGENTS.md',
  'template/agent-harness/docs/core/operating-model.md',
  'template/agent-harness/docs/manifest.yaml',
  'template/agent-harness/docs/prompt-rules.yaml',
  'template/agent-harness/docs/standards/user-profile-memory.md',
] as const;
const candidateSources = [
  ...rulesSources,
  'template/agent-harness/src/lib/docs-routing.ts',
  'template/agent-harness/src/lib/response-language.ts',
] as const;

function sha256(value: string | Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function fingerprint(paths: readonly string[]): string {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    hash
      .update(path)
      .update('\0')
      .update(readFileSync(join(repositoryRoot, path)))
      .update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function readCorpus(): { corpus: PromptRouteCorpus; bytes: Buffer } {
  const bytes = readFileSync(join(repositoryRoot, corpusRelative));
  const schema = JSON.parse(
    readFileSync(join(repositoryRoot, schemaRelative), 'utf8'),
  ) as AnySchema;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const value = JSON.parse(bytes.toString('utf8')) as unknown;
  if (!validate(value)) {
    throw new Error(`Prompt route corpus violates schema: ${JSON.stringify(validate.errors)}`);
  }
  const corpus = value as PromptRouteCorpus;
  const ids = corpus.cases.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error('Prompt route corpus ids must be unique');
  return { corpus, bytes };
}

export function runPromptRouteBenchmark(): PromptRouteBenchmarkReport {
  const { corpus, bytes } = readCorpus();
  const evaluation = evaluateCorpus(corpus, repositoryRoot);
  const metrics = benchmarkMetrics(corpus, evaluation);
  const thresholdMetrics = [
    metrics.actionTop1Accuracy,
    metrics.topicRecall,
    metrics.ambiguityPrecision,
    metrics.ambiguityRecall,
    metrics.ambiguityRate,
    metrics.forbiddenActionCount,
    metrics.ruleAdherenceRate,
  ];
  return {
    version: 1,
    schema: 'urn:harnessmith:prompt-route-benchmark:v1',
    result: thresholdMetrics.every(({ passed }) => passed) ? 'passed' : 'failed',
    sourceOfTruth: false,
    hostProof: false,
    corpusDigest: sha256(bytes),
    inputDigest: sha256(JSON.stringify(corpus.cases.map(({ id, query }) => ({ id, query })))),
    rulesFingerprint: fingerprint(rulesSources),
    candidateDigest: fingerprint(candidateSources),
    provenance: {
      runner: 'scripts/benchmarks/prompt-route-benchmark.ts',
      corpus: corpusRelative,
      layer: 'deterministic-router',
    },
    layers: {
      deterministicRouter: { status: 'measured', cases: evaluation.cases.length },
      mockEvaluator: { status: 'not-provided' },
      evaluator: { status: 'not-provided' },
      realHost: { status: 'not-provided' },
    },
    metrics,
    auditSamples: {
      falsePositiveGuards: corpus.cases
        .filter(({ categories }) => categories.includes('false-positive-guard'))
        .map(({ id }) => id),
      falseNegativeGuards: corpus.cases
        .filter(({ categories }) => categories.includes('false-negative-guard'))
        .map(({ id }) => id),
    },
    cases: evaluation.cases,
  };
}

const comparableMetrics = [
  'actionTop1Accuracy',
  'topicRecall',
  'ambiguityPrecision',
  'ambiguityRecall',
  'ambiguityRate',
  'forbiddenActionCount',
  'ruleAdherenceRate',
] as const;

export function comparePromptRouteBenchmarks(
  candidate: PromptRouteBenchmarkReport,
  baseline: PromptRouteBenchmarkReport,
): PromptRouteBenchmarkComparison {
  if (
    candidate.corpusDigest !== baseline.corpusDigest ||
    candidate.inputDigest !== baseline.inputDigest
  ) {
    throw new Error('Prompt route benchmark comparison requires the same corpus inputs');
  }
  return {
    version: 1,
    sameInput: true,
    baselineCandidateDigest: baseline.candidateDigest,
    candidateDigest: candidate.candidateDigest,
    metricDeltas: Object.fromEntries(
      comparableMetrics.map((name) => [
        name,
        candidate.metrics[name].value - baseline.metrics[name].value,
      ]),
    ),
  };
}
