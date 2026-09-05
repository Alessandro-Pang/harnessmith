export type DocumentationLoad = 'supporting' | 'reference';

export type DocumentationRouteKind = 'playbook' | 'topic' | 'standard';

export interface DocumentationManifestEntry {
  activationRules?: unknown;
  actionAliases?: unknown;
  conceptAliases?: unknown;
  kind?: unknown;
  load?: unknown;
  owner?: unknown;
  path?: unknown;
  priority?: unknown;
  requiredConceptAliases?: unknown;
  triggers?: unknown;
}

export interface DocumentationManifest {
  version?: unknown;
  entries?: unknown;
}

export interface PreparedManifestEntry {
  activationRules: ReasoningModeActivationRule[];
  name: string;
  kind: DocumentationRouteKind;
  load: DocumentationLoad;
  path: string;
  priority: number;
  aliases: string[];
  requiredAliases: string[];
}

export interface ReasoningModeActivationRule {
  mode: string;
  aliases: string[];
  signals: string[];
  minSignals: number;
  section: string;
  requiredArtifacts: string[];
}

export interface DocumentationRoute {
  kind: DocumentationRouteKind;
  name: string;
  path: string;
  priority: number;
  matchedAliases: string[];
}

export interface ReasoningModeActivation {
  mode: string;
  activation: 'explicit' | 'inferred';
  matchedSignals: string[];
  section: string;
  requiredArtifacts: string[];
}

export interface SupportingRouteCandidate {
  route: DocumentationRoute;
  required: boolean;
}

export interface PlaybookRouteEvidence {
  route: DocumentationRoute;
  mentioned: boolean;
  negated: boolean;
  requested: boolean;
}
