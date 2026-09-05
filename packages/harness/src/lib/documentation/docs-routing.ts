import {
  type ResponseLanguageContext,
  type ResponseLanguageDecision,
  resolveResponseLanguage,
} from '../routing/response-language.js';
import { loadDocumentationManifest } from './docs-routing-manifest.js';
import { normalizeRoutingText } from './docs-routing-matching.js';
import {
  boundReasoningModes,
  boundReferenceRoutes,
  boundSupportingRoutes,
  matchManifestRoutes,
} from './docs-routing-selection.js';
import type { DocumentationRoute, ReasoningModeActivation } from './docs-routing-types.js';

export const documentationIntents = [
  'change',
  'diagnose',
  'review',
  'research-and-design',
  'release-and-external',
  'understand-and-map',
  'verify-and-accept',
] as const;

export type DocumentationIntent = (typeof documentationIntents)[number];

export interface DocumentationRouteOptions {
  intent?: DocumentationIntent;
  languageContext?: ResponseLanguageContext;
}

export interface DocumentationRouteReport {
  version: 3;
  status: 'matched' | 'unmatched' | 'ambiguous';
  /** The caller-provided terms, retained for audit and replay. */
  rawQuery: string[];
  /** Normalized terms used by the matcher. */
  normalizedQuery: string[];
  /** @deprecated Use normalizedQuery. Kept for v3 consumers. */
  query: string[];
  routes: DocumentationRoute[];
  primaryPlaybook: DocumentationRoute | null;
  top1: DocumentationRoute | null;
  ambiguity: string[];
  topics: DocumentationRoute[];
  omittedTopics: DocumentationRoute[];
  /** Topics marked mandatory by the matched manifest aliases. */
  requiredTopics: DocumentationRoute[];
  /** Mandatory candidates not returned because the hard topic budget was exceeded. */
  omittedRequiredTopics: DocumentationRoute[];
  /** Deferred, low-frequency material selected by an explicit concept or activated reasoning mode. */
  references: DocumentationRoute[];
  omittedReferences: DocumentationRoute[];
  /** Reasoning modes selected from explicit concepts or inferred task signals. */
  reasoningModes: ReasoningModeActivation[];
  intent: {
    requested: string | null;
    source: 'explicit' | 'inferred' | 'none';
    mentionedActions: string[];
    negatedActions: string[];
  };
  responseLanguage: ResponseLanguageDecision;
}

function routingTerms(query: string[]): { terms: string[]; phrase: string } {
  const terms = query.map(normalizeRoutingText).filter(Boolean);
  if (terms.length === 0) throw new Error('At least one routing term is required');
  const uniqueTerms = [...new Set(terms)];
  return {
    terms: uniqueTerms,
    phrase: normalizeRoutingText(query.join(' ')) || uniqueTerms.join(' '),
  };
}

function selectPlaybook(
  evidence: Map<string, { route: DocumentationRoute; requested: boolean }>,
  intent: DocumentationIntent | undefined,
): {
  primary: DocumentationRoute | null;
  ambiguity: string[];
  selected: DocumentationRoute[];
} {
  const explicit = intent ? evidence.get(intent) : undefined;
  if (intent && !explicit) throw new Error(`Documentation intent has no playbook route: ${intent}`);
  const inferred = [...evidence.values()].filter(({ requested }) => requested);
  const selected = explicit ? [explicit] : inferred;
  const ambiguity =
    !explicit && selected.length > 1
      ? selected.map(({ route }) => route.name).sort((left, right) => left.localeCompare(right))
      : [];
  return {
    primary: ambiguity.length === 0 ? (selected[0]?.route ?? null) : null,
    ambiguity,
    selected: selected.map(({ route }) => route),
  };
}

export function routeDocumentation(
  docsRoot: string,
  query: string[],
  options: DocumentationRouteOptions = {},
): DocumentationRouteReport {
  const rawQuery = [...query];
  const { terms, phrase } = routingTerms(rawQuery);
  const { entries } = loadDocumentationManifest(docsRoot);
  const matches = matchManifestRoutes(docsRoot, entries, [phrase], [phrase, ...terms]);
  const playbooks = selectPlaybook(matches.playbookEvidence, options.intent);
  const topics = boundSupportingRoutes(matches.supportingRoutes);
  const reasoningModes = boundReasoningModes(matches.reasoningModes);
  const references = boundReferenceRoutes(
    matches.referenceRoutes,
    reasoningModes.length > 0 ? ['reasoning-modes'] : [],
  );
  const routes = [...playbooks.selected, ...topics.topics, ...references.references];
  const status =
    playbooks.ambiguity.length > 0 ? 'ambiguous' : routes.length > 0 ? 'matched' : 'unmatched';
  const mentionedActions = [...matches.playbookEvidence.entries()]
    .filter(([, evidence]) => evidence.mentioned)
    .map(([name]) => name);
  const negatedActions = [...matches.playbookEvidence.entries()]
    .filter(([, evidence]) => evidence.negated)
    .map(([name]) => name);
  return {
    version: 3,
    status,
    rawQuery,
    normalizedQuery: terms,
    query: terms,
    routes,
    primaryPlaybook: playbooks.primary,
    top1: playbooks.primary,
    ambiguity: playbooks.ambiguity,
    topics: topics.topics,
    omittedTopics: topics.omittedTopics,
    requiredTopics: topics.requiredTopics,
    omittedRequiredTopics: topics.omittedRequiredTopics,
    references: references.references,
    omittedReferences: references.omittedReferences,
    reasoningModes,
    intent: {
      requested: playbooks.primary?.name ?? null,
      source: options.intent ? 'explicit' : playbooks.selected.length > 0 ? 'inferred' : 'none',
      mentionedActions,
      negatedActions,
    },
    responseLanguage: resolveResponseLanguage(phrase, options.languageContext),
  };
}
