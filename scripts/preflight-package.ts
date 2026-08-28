import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evalAdapterEnum } from '../src/adapter-registry.js';

type Check = (condition: unknown, message: string) => void;

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function checkPublicGuidance(root: string, version: string, check: Check): void {
  const guidance = new Map([
    ['README.md', read(join(root, 'README.md'))],
    ['README.en.md', read(join(root, 'README.en.md'))],
    ['SECURITY.md', read(join(root, 'SECURITY.md'))],
    ['llms.txt', read(join(root, 'llms.txt'))],
  ]);
  check(
    guidance.get('llms.txt')?.includes('Release channel: npm registry (`latest` dist-tag)'),
    'llms.txt must identify the registry release channel',
  );
  check(
    guidance.get('SECURITY.md')?.includes('The latest published release receives security fixes'),
    'SECURITY.md must identify the support policy',
  );
  for (const [path, content] of guidance) {
    check(!content.includes(version), `${path} must not duplicate the package version`);
  }
}

function checkEvalAdapterEnum(root: string, check: Check): void {
  const schemaPath = join(root, 'evals', 'run.schema.json');
  check(existsSync(schemaPath), 'evals/run.schema.json is missing');
  if (!existsSync(schemaPath)) return;
  const schema = JSON.parse(read(schemaPath)) as {
    properties?: { host?: { properties?: { adapter?: { enum?: unknown } } } };
  };
  const enumValues = schema.properties?.host?.properties?.adapter?.enum;
  const expected = evalAdapterEnum();
  check(
    Array.isArray(enumValues) &&
      enumValues.length === expected.length &&
      enumValues.every((value, index) => value === expected[index]),
    `evals/run.schema.json host.adapter.enum must match adapter registry: ${expected.join(', ')}`,
  );
}

export function checkPackage(root: string, harnessRoot: string, check: Check): void {
  const manifest = JSON.parse(read(join(root, 'package.json'))) as {
    name?: string;
    version?: string;
    bin?: Record<string, string>;
    files?: string[];
    packageManager?: string;
    scripts?: Record<string, string>;
  };
  check(manifest.name === 'harnessmith', 'package name must remain harnessmith');
  check(Boolean(manifest.version), 'package version is missing');
  check(manifest.packageManager === 'pnpm@10.13.0', 'package manager must remain pnpm@10.13.0');
  check(existsSync(join(root, 'pnpm-lock.yaml')), 'pnpm-lock.yaml is missing');
  check(
    !existsSync(join(root, 'package-lock.json')),
    'package-lock.json conflicts with the pnpm lockfile',
  );
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    check(
      !/(^|[;&|]\s*)npm run\b/.test(command),
      `package script ${name} must compose scripts with pnpm`,
    );
  }
  check(manifest.bin?.harnessmith === 'bin/harnessmith.mjs', 'package bin mapping is invalid');
  for (const required of [
    'bin',
    'dist',
    'template/AGENTS.md',
    'template/agent-harness/bin',
    'template/agent-harness/dist',
    'template/agent-harness/docs',
    'template/agent-harness/manifest.json',
    'template/agent-harness/schemas',
    'template/agent-harness/templates',
    'evals/scenarios.json',
    'evals/scenarios.schema.json',
    'evals/run.schema.json',
    'llms.txt',
  ]) {
    check(manifest.files?.includes(required), `npm package files is missing ${required}`);
  }
  for (const sourceOnly of [
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'RELEASING.md',
    'docs/architecture.md',
    'evals/README.md',
    'evals/run.example.json',
  ]) {
    check(
      !manifest.files?.includes(sourceOnly),
      `npm package files includes source-only material ${sourceOnly}`,
    );
  }
  const evalNpmIgnore = join(root, 'evals', '.npmignore');
  check(existsSync(evalNpmIgnore), 'eval package boundary is missing .npmignore');
  check(
    existsSync(evalNpmIgnore) && /^README\.md$/m.test(read(evalNpmIgnore)),
    'eval package boundary must exclude its source README',
  );
  check(
    !manifest.files?.some(
      (path) =>
        path === 'template' || path.includes('agent-harness/src') || path.includes('__tests__'),
    ),
    'npm package files must not publish TypeScript sources or test directories',
  );
  check(existsSync(join(root, 'bin', 'harnessmith.mjs')), 'outer CLI launcher is missing');
  check(existsSync(join(harnessRoot, 'bin', 'harness.mjs')), 'Harness CLI launcher is missing');
  check(
    existsSync(join(harnessRoot, 'dist', 'harness.mjs')),
    'Harness bundle is missing; run pnpm run build',
  );

  const workflow = read(join(root, '.github', 'workflows', 'ci.yml'));
  check(workflow.includes('pnpm/action-setup@v6'), 'CI must set up pnpm with the supported action');
  check(
    workflow.includes('pnpm install --frozen-lockfile --ignore-scripts'),
    'CI must install the frozen pnpm lockfile without lifecycle scripts',
  );
  check(!workflow.includes('npm ci'), 'CI must not install dependencies with npm');
  checkPublicGuidance(root, manifest.version || '', check);
  checkEvalAdapterEnum(root, check);
}
