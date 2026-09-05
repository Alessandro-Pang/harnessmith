import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fdir } from 'fdir';
import { parse } from 'yaml';
import { supportedAgentNames } from '../../packages/cli/src/shared/agents.js';
import { parseFrontmatterDocument } from '../../packages/harness/src/lib/documentation/frontmatter.js';
import { markdownLinkTargets } from '../../packages/harness/src/lib/documentation/markdown-links.js';
import { promptRuleContractIssues } from '../benchmarks/prompt-route/prompt-rule-contract.js';
import { capabilityEvidenceIssues } from '../evaluation/capability-evidence.js';
import {
  type DocsManifest,
  documentRouteOwnershipIssues,
  invalidManifestRouteMetadata,
  type ManifestEntry,
  missingCanonicalRouteIds,
} from './preflight-docs-manifest.js';

export {
  documentRouteOwnershipIssues,
  invalidManifestRouteMetadata,
  missingCanonicalRouteIds,
} from './preflight-docs-manifest.js';

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

function manifestAliases(entry: ManifestEntry): unknown[] {
  const aliases = entry.kind === 'playbook' ? entry.actionAliases : entry.conceptAliases;
  const values = aliases === undefined ? entry.triggers : aliases;
  return Array.isArray(values) ? values : [];
}

function manifestRoutes(
  docsRoot: string,
  manifest: DocsManifest,
  check: DocsContext['check'],
): Set<string> {
  check(manifest.version === 1, 'agent-harness apps/docs/site manifest version must be 1');
  const validEntries =
    Boolean(manifest.entries) &&
    typeof manifest.entries === 'object' &&
    !Array.isArray(manifest.entries);
  check(validEntries, 'agent-harness apps/docs/site manifest entries must be an object');
  const entries = validEntries ? (manifest.entries as Record<string, ManifestEntry>) : {};
  const invalidMetadata = new Set(invalidManifestRouteMetadata(manifest));
  const routed = new Set<string>();
  for (const [name, entry] of Object.entries(entries)) {
    const validEntry = Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry);
    check(validEntry, `docs route ${name} must be an object`);
    check(!invalidMetadata.has(name), `docs route ${name} has invalid kind or priority`);
    const routePath = validEntry && typeof entry.path === 'string' ? entry.path.trim() : '';
    const aliases = validEntry ? manifestAliases(entry) : [];
    check(Boolean(routePath), `docs route ${name} has no path`);
    check(aliases.length > 0, `docs route ${name} has no aliases`);
    check(
      aliases.every((alias) => typeof alias === 'string' && alias.trim().length > 0),
      `docs route ${name} has invalid aliases`,
    );
    if (!routePath) continue;
    const target = resolve(docsRoot, routePath);
    check(
      target.startsWith(`${docsRoot}${sep}`),
      `docs route ${name} escapes the apps/docs/site directory`,
    );
    check(existsSync(target), `docs route ${name} points to missing file: ${routePath}`);
    routed.add(target);
  }
  return routed;
}

function checkMarkdownDocs(
  docsRoot: string,
  routed: Set<string>,
  check: DocsContext['check'],
): void {
  for (const path of filesUnder(docsRoot, (file) => extname(file) === '.md')) {
    const name = relative(docsRoot, path);
    const content = readFileSync(path, 'utf8');
    const frontmatter = parseFrontmatterDocument(content);
    check(frontmatter.found, `${name} is missing YAML frontmatter`);
    for (const field of ['title', 'type', 'status', 'updated']) {
      check(frontmatter.metadata.has(field), `${name} is missing frontmatter field: ${field}`);
    }
    if (name !== 'README.md') {
      check(routed.has(path), `${name} is not routed by apps/docs/site/manifest.yaml`);
    }
    for (const link of markdownLinkTargets(content)) {
      const target = link.split('#')[0];
      if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
      check(existsSync(resolve(dirname(path), target)), `${name} has broken link: ${link}`);
    }
  }
}

function checkPortableTemplate(root: string, check: DocsContext['check']): void {
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
  const hostIdentity = new RegExp(
    String.raw`\b(?:${supportedAgentNames.join('|')})\b|CODEX_HOME|CLAUDE_CONFIG_DIR|OPENCODE_CONFIG_DIR|KIMI_CODE_HOME`,
    'i',
  );
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
      !hostIdentity.test(content),
      `host-specific identity leaked into portable template: ${relative(root, path)}`,
    );
  }
}

export function checkDocs({ root, harnessRoot, check }: DocsContext): void {
  const capabilityEvidencePath = join(root, 'apps', 'docs', 'site', 'capability-evidence.yaml');
  check(existsSync(capabilityEvidencePath), 'capability evidence matrix is missing');
  if (existsSync(capabilityEvidencePath)) {
    const evidence = parse(readFileSync(capabilityEvidencePath, 'utf8')) as unknown;
    for (const issue of capabilityEvidenceIssues(root, evidence)) check(false, issue);
  }

  const docsRoot = join(harnessRoot, 'docs');
  const manifestPath = join(docsRoot, 'manifest.yaml');
  check(existsSync(manifestPath), 'agent-harness apps/docs/site manifest is missing');
  if (!existsSync(manifestPath)) return;
  const manifest = parse(readFileSync(manifestPath, 'utf8')) as DocsManifest;
  for (const id of missingCanonicalRouteIds(manifest)) {
    check(false, `agent-harness apps/docs/site manifest is missing canonical route: ${id}`);
  }
  const routed = manifestRoutes(docsRoot, manifest, check);
  for (const issue of documentRouteOwnershipIssues(docsRoot, manifest)) check(false, issue);
  const promptRulesPath = join(docsRoot, 'prompt-rules.yaml');
  check(existsSync(promptRulesPath), 'prompt rule contract is missing');
  if (existsSync(promptRulesPath)) {
    const contract = parse(readFileSync(promptRulesPath, 'utf8')) as unknown;
    for (const issue of promptRuleContractIssues(root, manifest, contract)) check(false, issue);
  }
  checkMarkdownDocs(docsRoot, routed, check);
  checkPortableTemplate(root, check);
}
