import { prepareManifestEntry } from './docs-routing-manifest.js';
import {
  matchesRoutingTerm,
  normalizeRoutingText,
  playbookAliasEvidence,
} from './docs-routing-matching.js';
import type {
  DocumentationManifestEntry,
  DocumentationRoute,
  PlaybookRouteEvidence,
  ReasoningModeActivation,
  SupportingRouteCandidate,
} from './docs-routing-types.js';

const maximumDocumentationTopics = 4;
const maximumDocumentationReferences = 2;

export interface ManifestRouteMatches {
  supportingRoutes: SupportingRouteCandidate[];
  referenceRoutes: DocumentationRoute[];
  playbookEvidence: Map<string, PlaybookRouteEvidence>;
  reasoningModes: ReasoningModeActivation[];
}

function reasoningModeMatches(
  entry: ReturnType<typeof prepareManifestEntry>,
  conceptTerms: string[],
): ReasoningModeActivation[] {
  return entry.activationRules.flatMap((rule): ReasoningModeActivation[] => {
    const explicit = rule.aliases.filter((alias) =>
      conceptTerms.some((term) => matchesRoutingTerm(alias, term)),
    );
    if (explicit.length > 0) {
      return [
        {
          mode: rule.mode,
          activation: 'explicit' as const,
          matchedSignals: explicit,
          section: rule.section,
          requiredArtifacts: rule.requiredArtifacts,
        },
      ];
    }
    const signals = rule.signals.filter((signal) =>
      conceptTerms.some((term) => matchesRoutingTerm(signal, term)),
    );
    return signals.length >= rule.minSignals
      ? [
          {
            mode: rule.mode,
            activation: 'inferred' as const,
            matchedSignals: signals,
            section: rule.section,
            requiredArtifacts: rule.requiredArtifacts,
          },
        ]
      : [];
  });
}

function routeFor(
  entry: ReturnType<typeof prepareManifestEntry>,
  matchedAliases: string[],
): DocumentationRoute {
  return {
    kind: entry.kind,
    name: entry.name,
    path: entry.path,
    priority: entry.priority,
    matchedAliases,
  };
}

function matchPlaybook(
  entry: ReturnType<typeof prepareManifestEntry>,
  actionTerms: string[],
): PlaybookRouteEvidence {
  const evidence = entry.aliases.flatMap((alias) =>
    actionTerms.map((term) => ({ alias, ...playbookAliasEvidence(alias, term) })),
  );
  return {
    route: routeFor(
      entry,
      evidence.filter(({ mentioned }) => mentioned).map(({ alias }) => alias),
    ),
    mentioned: evidence.some(({ mentioned }) => mentioned),
    negated: evidence.some(({ negated }) => negated),
    requested: evidence.some(({ requested }) => requested),
  };
}

export function matchManifestRoutes(
  docsRoot: string,
  entries: Record<string, DocumentationManifestEntry>,
  actionTerms: string[],
  conceptTerms: string[],
): ManifestRouteMatches {
  const supportingRoutes: SupportingRouteCandidate[] = [];
  const referenceRoutes: DocumentationRoute[] = [];
  const playbookEvidence = new Map<string, PlaybookRouteEvidence>();
  const reasoningModes: ReasoningModeActivation[] = [];
  for (const [name, rawEntry] of Object.entries(entries)) {
    const entry = prepareManifestEntry(docsRoot, entries, name, rawEntry);
    if (entry.kind === 'playbook') {
      playbookEvidence.set(name, matchPlaybook(entry, actionTerms));
      continue;
    }
    const matchedAliases = entry.aliases.filter((alias) =>
      conceptTerms.some((term) => matchesRoutingTerm(alias, term)),
    );
    const modeMatches = reasoningModeMatches(entry, conceptTerms);
    if (matchedAliases.length === 0 && modeMatches.length === 0) continue;
    reasoningModes.push(...modeMatches);
    const route = routeFor(entry, [
      ...matchedAliases,
      ...modeMatches.flatMap(({ matchedSignals }) => matchedSignals),
    ]);
    if (entry.load === 'reference') {
      referenceRoutes.push(route);
      continue;
    }
    const required = matchedAliases.some((alias) =>
      entry.requiredAliases.some(
        (requiredAlias) => normalizeRoutingText(requiredAlias) === normalizeRoutingText(alias),
      ),
    );
    supportingRoutes.push({ route, required });
  }
  return { supportingRoutes, referenceRoutes, playbookEvidence, reasoningModes };
}

export function boundReasoningModes(modes: ReasoningModeActivation[]): ReasoningModeActivation[] {
  return modes
    .map((mode, index) => ({ mode, index }))
    .sort(
      (left, right) =>
        Number(right.mode.activation === 'explicit') -
          Number(left.mode.activation === 'explicit') ||
        right.mode.matchedSignals.length - left.mode.matchedSignals.length ||
        left.index - right.index,
    )
    .slice(0, 2)
    .map(({ mode }) => mode);
}

function rankedRoutes(routes: DocumentationRoute[]): DocumentationRoute[] {
  return routes
    .map((route, index) => ({ route, index }))
    .sort(
      (left, right) =>
        right.route.matchedAliases.length - left.route.matchedAliases.length ||
        left.index - right.index,
    )
    .map(({ route }) => route);
}

export function boundSupportingRoutes(routes: SupportingRouteCandidate[]): {
  topics: DocumentationRoute[];
  omittedTopics: DocumentationRoute[];
  requiredTopics: DocumentationRoute[];
  omittedRequiredTopics: DocumentationRoute[];
} {
  const ranked = routes
    .map((candidate, index) => ({ candidate, index }))
    .sort(
      (left, right) =>
        right.candidate.route.matchedAliases.length - left.candidate.route.matchedAliases.length ||
        left.index - right.index,
    )
    .map(({ candidate }) => candidate);
  const required = ranked.filter(({ required }) => required);
  const optional = ranked.filter(({ required }) => !required);
  const selectedRequired = required.slice(0, maximumDocumentationTopics);
  const selected = [
    ...selectedRequired,
    ...optional.slice(0, Math.max(0, maximumDocumentationTopics - selectedRequired.length)),
  ];
  const selectedNames = new Set(selected.map(({ route }) => route.name));
  return {
    topics: selected.map(({ route }) => route),
    omittedTopics: optional
      .filter(({ route }) => !selectedNames.has(route.name))
      .map(({ route }) => route),
    requiredTopics: selectedRequired.map(({ route }) => route),
    omittedRequiredTopics: required
      .filter(({ route }) => !selectedNames.has(route.name))
      .map(({ route }) => route),
  };
}

export function boundReferenceRoutes(
  routes: DocumentationRoute[],
  requiredNames: string[] = [],
): {
  references: DocumentationRoute[];
  omittedReferences: DocumentationRoute[];
} {
  const ranked = rankedRoutes(routes);
  const required = ranked.filter(({ name }) => requiredNames.includes(name));
  const optional = ranked.filter(({ name }) => !requiredNames.includes(name));
  const selected = [...required, ...optional].slice(0, maximumDocumentationReferences);
  const selectedNames = new Set(selected.map(({ name }) => name));
  return {
    references: selected,
    omittedReferences: ranked.filter(({ name }) => !selectedNames.has(name)),
  };
}
