import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { execaSync } from 'execa';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fingerprintProperty = 'harnessmith:source-inputs-sha256';

interface Property {
  name: string;
  value: string;
}

interface SbomDocument {
  metadata?: {
    properties?: Property[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function sourceFingerprint(root: string): string {
  const hash = createHash('sha256');
  hash.update('harnessmith-sbom-source-v1\0');
  for (const name of ['package.json', 'pnpm-lock.yaml']) {
    const path = join(root, name);
    if (!existsSync(path)) throw new Error(`SBOM source input is missing: ${path}`);
    const content = readFileSync(path);
    hash.update(name);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function readSbom(path: string): SbomDocument {
  if (!existsSync(path)) throw new Error(`SBOM is missing: ${path}`);
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as SbomDocument;
  if (parsed.metadata === undefined) parsed.metadata = {};
  if (!Array.isArray(parsed.metadata.properties)) parsed.metadata.properties = [];
  return parsed;
}

function stamp(root: string, output: string): void {
  const document = readSbom(output);
  const properties = document.metadata?.properties ?? [];
  document.metadata = {
    ...document.metadata,
    properties: [
      ...properties.filter(({ name }) => name !== fingerprintProperty),
      { name: fingerprintProperty, value: sourceFingerprint(root) },
    ],
  };
  writeFileSync(output, `${JSON.stringify(document)}\n`);
  console.log(`Stamped SBOM source fingerprint: ${output}`);
}

function check(root: string, output: string): void {
  const document = readSbom(output);
  const recorded = document.metadata?.properties?.find(
    ({ name }) => name === fingerprintProperty,
  )?.value;
  if (!recorded) throw new Error(`SBOM source fingerprint is missing: ${output}`);
  if (recorded !== sourceFingerprint(root)) {
    throw new Error('SBOM is stale for the current package and lockfile; run pnpm run sbom');
  }
  console.log(`SBOM freshness check passed: ${output}`);
}

function generatorEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const credentialLike =
    /(?:^|_)(?:api_key|auth|credential|password|private_key|secret|session|token)(?:_|$)/i;
  for (const key of Object.keys(env)) {
    if (key === 'NODE_PATH' || credentialLike.test(key)) delete env[key];
  }
  return env;
}

function generate(root: string, output: string): void {
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = execaSync(
    pnpm,
    [
      'dlx',
      '@cyclonedx/cdxgen@12.8.2',
      '-t',
      'js',
      '--no-install-deps',
      '--fail-on-error',
      '-o',
      output,
      root,
    ],
    { env: generatorEnvironment(), extendEnv: false, reject: false, stdio: 'inherit' },
  );
  if (result.failed) throw new Error(`SBOM generation failed with exit ${String(result.exitCode)}`);
  stamp(root, output);
  check(root, output);
}

function commandOptions(command: Command): Command {
  return command
    .option('--root <path>', 'source repository root', repositoryRoot)
    .option(
      '--output <path>',
      'CycloneDX JSON path',
      join(repositoryRoot, 'harnessmith-sbom.cdx.json'),
    );
}

const program = new Command().name('sbom').description('generate and validate the release SBOM');
commandOptions(program.command('generate')).action(({ root, output }) =>
  generate(resolve(root), resolve(output)),
);
commandOptions(program.command('stamp')).action(({ root, output }) =>
  stamp(resolve(root), resolve(output)),
);
commandOptions(program.command('check')).action(({ root, output }) =>
  check(resolve(root), resolve(output)),
);

try {
  program.parse();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
