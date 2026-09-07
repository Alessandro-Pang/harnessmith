import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import type { SuiteCaseResult } from '../codex/eval-suite-evidence.js';
import { type EvaluationCase, evaluationRegistry } from '../codex/eval-suite-registry.js';
import { repositoryRoot } from '../records/eval-fingerprint.js';

type CoverageCell = {
  required: string[];
  executable: string[];
  measured: string[];
  missing: string[];
  unmeasured: string[];
};
const load = (path: string) => JSON.parse(readFileSync(join(repositoryRoot, path), 'utf8'));
function cells(
  required: string[],
  entries: EvaluationCase[],
  results: SuiteCaseResult[],
): CoverageCell {
  const executable = required.filter((id) =>
    entries.some((entry) => entry.implemented && entry.requirements.includes(id)),
  );
  const measured = required.filter((id) => {
    const owners = entries.filter((entry) => entry.requirements.includes(id));
    return (
      owners.length > 0 &&
      owners.every(
        (entry) =>
          entry.implemented &&
          results.some(
            (result) =>
              result.scenarioId === entry.id &&
              result.outcome === 'passed' &&
              result.recordRef &&
              result.recordSha256,
          ),
      )
    );
  });
  return {
    required,
    executable,
    measured,
    missing: required.filter((id) => !executable.includes(id)),
    unmeasured: required.filter((id) => !measured.includes(id)),
  };
}

function promptInventory(
  manifest: { entries: Record<string, { kind: string }> },
  rules: {
    rules: {
      id: string;
      owner: string;
      guarantee: string;
      evidence?: { verification?: string[] };
    }[];
  },
) {
  return {
    playbooks: Object.entries(manifest.entries)
      .filter(([, entry]) => entry.kind === 'playbook')
      .map(([id]) => id),
    topics: Object.entries(manifest.entries)
      .filter(([, entry]) => entry.kind !== 'playbook')
      .map(([id]) => id),
    rules: rules.rules.map((rule) => ({
      id: rule.id,
      owner: rule.owner,
      guarantee: rule.guarantee,
      runtimeVerification: rule.evidence?.verification ?? [],
    })),
  };
}

type CoverageContract = {
  requiredReasoningModes: string[];
  requiredReasoningActivations: string[];
  requiredMemoryOperations: string[];
  requiredProfileScenarios: string[];
  requiredPlaybooks: string[];
  requiredHostEvidence: string[];
};
function loadCoverageContract(): CoverageContract {
  return load('evals/coverage.v1.json') as CoverageContract;
}
function hostEvidenceCoverage(required: string[], results: SuiteCaseResult[]) {
  return Object.fromEntries(
    required.map((kind) => [
      kind,
      {
        required: true,
        measured: results.some(
          (result) =>
            result.outcome === 'passed' &&
            result.recordRef &&
            result.recordSha256 &&
            result.evidenceKinds?.includes(kind),
        ),
      },
    ]),
  );
}
function scenarioCoverage(entries: EvaluationCase[], results: SuiteCaseResult[]) {
  const measured = (result: SuiteCaseResult) =>
    result.outcome === 'passed' && result.recordRef && result.recordSha256;
  return {
    required: entries.length,
    executable: entries.filter((entry) => entry.implemented).length,
    measured: results.filter(measured).length,
    missing: entries.filter((entry) => !entry.implemented).map((entry) => entry.id),
    unmeasured: entries
      .filter(
        (entry) => !results.some((result) => result.scenarioId === entry.id && measured(result)),
      )
      .map((entry) => entry.id),
  };
}

export function evaluateCoverage(results: SuiteCaseResult[] = [], entries = evaluationRegistry()) {
  const contract = loadCoverageContract();
  const manifest = YAML.parse(
    readFileSync(join(repositoryRoot, 'template/agent-harness/docs/manifest.yaml'), 'utf8'),
  ) as { entries: Record<string, { kind: string; activationRules?: { mode: string }[] }> };
  const rules = YAML.parse(
    readFileSync(join(repositoryRoot, 'template/agent-harness/docs/prompt-rules.yaml'), 'utf8'),
  ) as {
    rules: {
      id: string;
      owner: string;
      guarantee: string;
      evidence?: { verification?: string[] };
    }[];
  };
  const modeNames =
    manifest.entries['reasoning-modes'].activationRules?.map((rule) => rule.mode) ?? [];
  const requiredModes = [...new Set([...modeNames, ...contract.requiredReasoningModes])];
  const reasoning = cells(
    [
      ...requiredModes.flatMap((mode) =>
        contract.requiredReasoningActivations.map(
          (activation) => `reasoning:${mode}:${activation}`,
        ),
      ),
      'reasoning:negative',
    ],
    entries,
    results,
  );
  const memory = cells(
    contract.requiredMemoryOperations.map((operation) => `memory-operation:${operation}`),
    entries,
    results,
  );
  const profile = cells(
    contract.requiredProfileScenarios.map((id) => `profile-scenario:${id}`),
    entries,
    results,
  );
  const playbooks = cells(
    contract.requiredPlaybooks.map((id) => `playbook:${id}`),
    entries,
    results,
  );
  const hostEvidence = hostEvidenceCoverage(contract.requiredHostEvidence, results);
  const scenarios = scenarioCoverage(entries, results);
  return {
    version: 2 as const,
    result:
      [
        ...reasoning.unmeasured,
        ...memory.unmeasured,
        ...profile.unmeasured,
        ...playbooks.unmeasured,
        ...scenarios.unmeasured,
        ...Object.entries(hostEvidence)
          .filter(([, value]) => !value.measured)
          .map(([kind]) => `host-evidence:${kind}`),
      ].length === 0
        ? ('passed' as const)
        : ('inconclusive' as const),
    reasoning,
    memory,
    profile,
    playbooks,
    hostEvidence,
    scenarios,
    promptInventory: promptInventory(manifest, rules),
  };
}
