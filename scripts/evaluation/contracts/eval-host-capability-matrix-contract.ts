import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AnySchema } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  type AgentName,
  supportedAgentNames,
} from '../../../packages/cli/src/adapters/adapter-registry.js';
import { worktreeScenarioCatalog } from '../planning/eval-scenarios.js';
import { repositoryRoot } from '../records/eval-fingerprint.js';

type SupportState = 'executable' | 'inconclusive' | 'unsupported';
type Support = { state: SupportState; reason: string; evidence: string[] };
type Host = Support & { id: AgentName };
type Capability = {
  id: string;
  description: string;
  scenarioIds: string[];
  supportOverrides?: Partial<Record<AgentName, Support>>;
};
export type HostCapabilityMatrix = {
  schemaVersion: 1;
  hosts: Host[];
  capabilities: Capability[];
};

const contractPath = join(repositoryRoot, 'evals', 'host-capability-matrix.v1.json');
const schemaPath = join(repositoryRoot, 'evals', 'host-capability-matrix.schema.json');

function validateContract(matrix: HostCapabilityMatrix): HostCapabilityMatrix {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as AnySchema;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  if (!validate(matrix)) {
    throw new Error(`Host capability matrix violates schema: ${JSON.stringify(validate.errors)}`);
  }
  const expectedHosts: AgentName[] = [...supportedAgentNames];
  if (matrix.hosts.some(({ id }, index) => id !== expectedHosts[index])) {
    throw new Error('Host capability matrix must contain the canonical ordered Host list');
  }
  const capabilityIds = matrix.capabilities.map(({ id }) => id);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    throw new Error('Host capability matrix capability ids must be unique');
  }
  const scenarios = new Set(worktreeScenarioCatalog(repositoryRoot).scenarios.map(({ id }) => id));
  for (const capability of matrix.capabilities) {
    for (const scenarioId of capability.scenarioIds) {
      if (!scenarios.has(scenarioId)) {
        throw new Error(`Host capability matrix references unknown scenario: ${scenarioId}`);
      }
    }
    for (const host of matrix.hosts) {
      const support = capability.supportOverrides?.[host.id] ?? host;
      if (support.state === 'executable' && capability.scenarioIds.length === 0) {
        throw new Error(`Executable ${host.id}/${capability.id} cell must reference a scenario`);
      }
      for (const path of support.evidence) {
        if (!existsSync(join(repositoryRoot, path))) {
          throw new Error(`Host capability matrix evidence is missing: ${path}`);
        }
      }
    }
  }
  return matrix;
}

export function readHostCapabilityMatrix(raw?: HostCapabilityMatrix): HostCapabilityMatrix {
  return validateContract(
    raw ?? (JSON.parse(readFileSync(contractPath, 'utf8')) as HostCapabilityMatrix),
  );
}
