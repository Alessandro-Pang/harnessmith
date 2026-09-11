import { join } from 'node:path';
import {
  type DocumentationIntent,
  type DocumentationRouteReport,
  routeDocumentation,
} from '../../lib/documentation/docs-routing.js';
import type { ReasoningModeActivation } from '../../lib/documentation/docs-routing-types.js';
import { assertNoHighConfidenceSecret } from '../../lib/security/secret-hygiene.js';
import type { Runtime } from '../../types.js';

/**
 * Routing folded into the startup command. The always-on entry runs exactly one command per
 * task; this summary turns the route report into an ordered `load` list so the agent makes no
 * routing decision of its own. `ask` is the only branch: non-null means stop and ask the user.
 */
export interface BootstrapRouteSummary {
  status: DocumentationRouteReport['status'];
  intent: DocumentationRouteReport['intent'];
  primaryPlaybook: string | null;
  /** Absolute document paths in reading order; empty unless `status` is `matched`. */
  load: string[];
  reasoningModes: ReasoningModeActivation[];
  omittedRequiredTopics: string[];
  omittedTopics: string[];
  ask: string | null;
}

const executionLoop = ['core', 'execution-loop.md'];
const reasoningReference = ['references', 'reasoning-modes.md'];

function askFor(report: DocumentationRouteReport): string | null {
  if (report.status === 'unmatched') {
    return 'No Harness playbook matched the request; ask the user which action they want (change, diagnose, review, research-and-design, understand-and-map, verify-and-accept, release-and-external) before acting.';
  }
  if (report.status === 'ambiguous') {
    return `The request matches several playbooks (${report.ambiguity.join(', ')}); ask the user which single action applies before acting.`;
  }
  if (report.omittedRequiredTopics.length > 0) {
    return `Required documentation was omitted by the topic budget (${report.omittedRequiredTopics.map(({ name }) => name).join(', ')}); narrow the task or re-route explicitly before acting.`;
  }
  return null;
}

function loadOrder(docsRoot: string, report: DocumentationRouteReport): string[] {
  if (report.status !== 'matched') return [];
  const ordered = [
    join(docsRoot, ...executionLoop),
    ...(report.primaryPlaybook ? [report.primaryPlaybook.path] : []),
    ...report.requiredTopics.map(({ path }) => path),
    ...report.topics.map(({ path }) => path),
    ...(report.reasoningModes.length > 0 ? [join(docsRoot, ...reasoningReference)] : []),
  ];
  return [...new Set(ordered)];
}

export function bootstrapRoute(
  runtime: Runtime,
  query: string[],
  intent?: DocumentationIntent,
): BootstrapRouteSummary {
  assertNoHighConfidenceSecret(query, 'Bootstrap route query');
  const report = routeDocumentation(runtime.docsRoot, query, { intent });
  return {
    status: report.status,
    intent: report.intent,
    primaryPlaybook: report.primaryPlaybook?.path ?? null,
    load: loadOrder(runtime.docsRoot, report),
    reasoningModes: report.reasoningModes,
    omittedRequiredTopics: report.omittedRequiredTopics.map(({ name }) => name),
    omittedTopics: report.omittedTopics.map(({ name }) => name),
    ask: askFor(report),
  };
}
