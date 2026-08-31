import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fdir } from 'fdir';
import { parse } from 'yaml';
import { supportedAgentNames } from '../src/agents.js';
import { parseFrontmatterDocument } from '../template/agent-harness/src/lib/frontmatter.js';
import { markdownLinkTargets } from '../template/agent-harness/src/lib/markdown-links.js';
import { capabilityEvidenceIssues } from './capability-evidence.js';

interface ManifestEntry {
  kind?: unknown;
  path?: unknown;
  priority?: unknown;
  triggers?: unknown;
}

interface DocsManifest {
  version?: number;
  entries?: unknown;
}

interface DocsContext {
  root: string;
  harnessRoot: string;
  check: (condition: unknown, message: string) => void;
}

export function filesUnder(
  directory: string,
  filter: (path: string) => boolean = () => true,
): string[] {
  if (!existsSync(directory)) return [];
  return new fdir({ excludeSymlinks: true })
    .withErrors()
    .withFullPaths()
    .filter((path, isDirectory) => isDirectory || filter(path))
    .crawl(directory)
    .sync()
    .sort();
}

type Check = DocsContext['check'];

const CANONICAL_ROUTE_IDS = [
  'operating-model',
  'tool-routing',
  'safety-and-verification',
  'git-conventions',
  'harness-cli-architecture',
  'long-running-tasks',
  'change',
  'diagnose',
  'review',
  'research-and-design',
  'release-and-external',
  'repository-map',
  'project-agents',
  'project-agent-docs',
  'user-profile-memory',
] as const;

export function missingCanonicalRouteIds(manifest: unknown): string[] {
  const entries =
    manifest && typeof manifest === 'object' && !Array.isArray(manifest)
      ? (manifest as DocsManifest).entries
      : undefined;
  const routes =
    entries && typeof entries === 'object' && !Array.isArray(entries)
      ? (entries as Record<string, unknown>)
      : {};
  return CANONICAL_ROUTE_IDS.filter((id) => !Object.hasOwn(routes, id));
}

export function invalidManifestRouteMetadata(manifest: unknown): string[] {
  const entries =
    manifest && typeof manifest === 'object' && !Array.isArray(manifest)
      ? (manifest as DocsManifest).entries
      : undefined;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return [];
  const kinds = new Set(['playbook', 'topic', 'standard']);
  return Object.entries(entries as Record<string, ManifestEntry>)
    .filter(([, entry]) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
      if (typeof entry.kind !== 'string' || !kinds.has(entry.kind)) return true;
      if (entry.kind === 'playbook')
        return !Number.isInteger(entry.priority) || (entry.priority as number) <= 0;
      return entry.priority !== undefined && !Number.isInteger(entry.priority);
    })
    .map(([id]) => id)
    .sort();
}

function manifestRoutes(docsRoot: string, manifest: DocsManifest, check: Check): Set<string> {
  check(manifest.version === 1, 'agent-harness docs manifest version must be 1');
  const validEntries =
    Boolean(manifest.entries) &&
    typeof manifest.entries === 'object' &&
    !Array.isArray(manifest.entries);
  check(validEntries, 'agent-harness docs manifest entries must be an object');
  const entries = validEntries ? (manifest.entries as Record<string, ManifestEntry>) : {};
  const invalidMetadata = new Set(invalidManifestRouteMetadata(manifest));
  const routed = new Set<string>();
  for (const [name, entry] of Object.entries(entries)) {
    const validEntry = Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry);
    check(validEntry, `docs route ${name} must be an object`);
    check(!invalidMetadata.has(name), `docs route ${name} has invalid kind or priority`);
    const routePath = validEntry && typeof entry.path === 'string' ? entry.path.trim() : '';
    const triggers = validEntry && Array.isArray(entry.triggers) ? entry.triggers : [];
    check(Boolean(routePath), `docs route ${name} has no path`);
    check(triggers.length > 0, `docs route ${name} has no triggers`);
    check(
      triggers.every((trigger) => typeof trigger === 'string' && trigger.trim().length > 0),
      `docs route ${name} has invalid triggers`,
    );
    check(new Set(triggers).size === triggers.length, `docs route ${name} has duplicate triggers`);
    if (!routePath) continue;
    const target = resolve(docsRoot, routePath);
    check(target.startsWith(`${docsRoot}${sep}`), `docs route ${name} escapes the docs directory`);
    check(existsSync(target), `docs route ${name} points to missing file: ${routePath}`);
    routed.add(target);
  }
  return routed;
}

function checkMarkdownDocs(docsRoot: string, routed: Set<string>, check: Check): void {
  for (const path of filesUnder(docsRoot, (path) => extname(path) === '.md')) {
    const name = relative(docsRoot, path);
    const content = readFileSync(path, 'utf8');
    const frontmatter = parseFrontmatterDocument(content);
    check(frontmatter.found, `${name} is missing YAML frontmatter`);
    for (const field of ['title', 'type', 'status', 'updated']) {
      check(frontmatter.metadata.has(field), `${name} is missing frontmatter field: ${field}`);
    }
    if (name !== 'README.md')
      check(routed.has(path), `${name} is not routed by docs/manifest.yaml`);
    for (const link of markdownLinkTargets(content)) {
      const target = link.split('#')[0];
      if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
      check(existsSync(resolve(dirname(path), target)), `${name} has broken link: ${link}`);
    }
  }
}

function checkPortableTemplate(root: string, check: Check): void {
  const allowedTokens = new Set([
    'HARNESS_HOME',
    'HARNESS_MEMORY_HOME',
    'HARNESS_OWNER',
    'HARNESS_PERSONAL_HOME',
    'HARNESS_REPOSITORY_ROOT',
    'PROJECT_KEY',
    'PROJECT_ROOT',
    'DATE',
    'TIMESTAMP',
  ]);
  for (const path of filesUnder(join(root, 'template'))) {
    if (path.includes(`${sep}dist${sep}`) || path.includes(`${sep}__tests__${sep}`)) continue;
    if (statSync(path).size > 250_000) continue;
    const content = readFileSync(path, 'utf8');
    for (const match of content.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)) {
      check(
        allowedTokens.has(match[1]),
        `unknown template token ${match[0]} in ${relative(root, path)}`,
      );
    }
    check(
      !new RegExp(
        String.raw`\b(?:${supportedAgentNames.join('|')})\b|CODEX_HOME|CLAUDE_CONFIG_DIR|OPENCODE_CONFIG_DIR|KIMI_CODE_HOME`,
        'i',
      ).test(content),
      `host-specific identity leaked into portable template: ${relative(root, path)}`,
    );
  }
}

export function checkDocs({ root, harnessRoot, check }: DocsContext): void {
  const capabilityEvidencePath = join(root, 'docs', 'capability-evidence.yaml');
  check(existsSync(capabilityEvidencePath), 'capability evidence matrix is missing');
  if (existsSync(capabilityEvidencePath)) {
    const evidence = parse(readFileSync(capabilityEvidencePath, 'utf8')) as unknown;
    for (const issue of capabilityEvidenceIssues(root, evidence)) check(false, issue);
  }

  const docsRoot = join(harnessRoot, 'docs');
  const manifestPath = join(docsRoot, 'manifest.yaml');
  check(existsSync(manifestPath), 'agent-harness docs manifest is missing');
  if (!existsSync(manifestPath)) return;
  const manifest = parse(readFileSync(manifestPath, 'utf8')) as DocsManifest;
  for (const id of missingCanonicalRouteIds(manifest)) {
    check(false, `agent-harness docs manifest is missing canonical route: ${id}`);
  }
  const routed = manifestRoutes(docsRoot, manifest, check);
  checkMarkdownDocs(docsRoot, routed, check);
  checkPortableTemplate(root, check);
}
