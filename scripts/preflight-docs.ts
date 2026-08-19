import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';

interface ManifestEntry {
  path?: string;
}

interface DocsManifest {
  version?: number;
  entries?: Record<string, ManifestEntry>;
}

interface DocsContext {
  root: string;
  harnessRoot: string;
  check: (condition: unknown, message: string) => void;
}

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function metadata(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const value = parse(match[1]);
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export function checkDocs({ root, harnessRoot, check }: DocsContext): void {
  const docsRoot = join(harnessRoot, 'docs');
  const manifestPath = join(docsRoot, 'manifest.yaml');
  check(existsSync(manifestPath), 'agent-harness docs manifest is missing');
  if (!existsSync(manifestPath)) return;

  const manifest = parse(readFileSync(manifestPath, 'utf8')) as DocsManifest;
  check(manifest.version === 1, 'agent-harness docs manifest version must be 1');
  const routed = new Set<string>();
  for (const [name, entry] of Object.entries(manifest.entries ?? {})) {
    check(Boolean(entry.path), `docs route ${name} has no path`);
    if (!entry.path) continue;
    const target = resolve(docsRoot, entry.path);
    check(target.startsWith(`${docsRoot}${sep}`), `docs route ${name} escapes the docs directory`);
    check(existsSync(target), `docs route ${name} points to missing file: ${entry.path}`);
    routed.add(target);
  }

  for (const path of filesUnder(docsRoot).filter((path) => extname(path) === '.md')) {
    const name = relative(docsRoot, path);
    const content = readFileSync(path, 'utf8');
    const frontmatter = metadata(content);
    check(frontmatter !== null, `${name} is missing YAML frontmatter`);
    for (const field of ['title', 'type', 'status', 'updated']) {
      check(frontmatter?.[field] !== undefined, `${name} is missing frontmatter field: ${field}`);
    }
    if (name !== 'README.md')
      check(routed.has(path), `${name} is not routed by docs/manifest.yaml`);
    for (const match of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
      check(existsSync(resolve(dirname(path), target)), `${name} has broken link: ${match[1]}`);
    }
  }

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
      !/\b(?:codex|cursor|claude)\b|CODEX_HOME|CLAUDE_CONFIG_DIR/i.test(content),
      `host-specific identity leaked into portable template: ${relative(root, path)}`,
    );
  }
}
