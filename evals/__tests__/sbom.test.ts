import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(root, 'scripts', 'sbom.ts');

function fixture(): { project: string; sbom: string } {
  const project = mkdtempSync(join(tmpdir(), 'harness-sbom-'));
  onTestFinished(() => rmSync(project, { recursive: true, force: true }));
  writeFileSync(join(project, 'package.json'), '{"name":"fixture","version":"1.0.0"}\n');
  writeFileSync(join(project, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const sbom = join(project, 'sbom.json');
  writeFileSync(
    sbom,
    `${JSON.stringify({ bomFormat: 'CycloneDX', metadata: { properties: [] } }, null, 2)}\n`,
  );
  return { project, sbom };
}

function run(args: string[], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
}

function fakePnpm(bin: string, envRecord: string): void {
  mkdirSync(bin);
  const source = `
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
writeFileSync(${JSON.stringify(envRecord)}, JSON.stringify({
  nodePath: process.env.NODE_PATH,
  apiKey: process.env.GPUGEEK_API_KEY,
  session: process.env.__MISE_SESSION,
}));
const output = args[args.indexOf('-o') + 1];
writeFileSync(output, JSON.stringify({ bomFormat: 'CycloneDX', metadata: { properties: [] } }));
`;
  const executable = join(bin, process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm');
  if (process.platform === 'win32') {
    const module = join(bin, 'pnpm.mjs');
    writeFileSync(module, source);
    writeFileSync(executable, `@echo off\r\n"${process.execPath}" "${module}" %*\r\n`);
  } else {
    writeFileSync(executable, `#!${process.execPath}\n${source}`);
    chmodSync(executable, 0o755);
  }
}

test('SBOM stamp records source inputs and check accepts the unchanged project', () => {
  const { project, sbom } = fixture();

  const stamp = run(['stamp', '--root', project, '--output', sbom]);
  assert.equal(stamp.status, 0, stamp.stderr);
  const check = run(['check', '--root', project, '--output', sbom]);

  assert.equal(check.status, 0, check.stderr);
  const document = JSON.parse(readFileSync(sbom, 'utf8'));
  assert.match(
    document.metadata.properties.find(
      ({ name }: { name: string }) => name === 'harnessmith:source-inputs-sha256',
    )?.value ?? '',
    /^[a-f0-9]{64}$/,
  );
  assert.equal(readFileSync(sbom, 'utf8').trimEnd().split('\n').length, 1);
});

test('SBOM check rejects a document after dependency inputs change', () => {
  const { project, sbom } = fixture();
  assert.equal(run(['stamp', '--root', project, '--output', sbom]).status, 0);
  writeFileSync(join(project, 'package.json'), '{"name":"fixture","version":"1.0.1"}\n');

  const check = run(['check', '--root', project, '--output', sbom]);

  assert.equal(check.status, 1);
  assert.match(check.stderr, /SBOM is stale for the current package and lockfile/i);
});

test('SBOM generation does not expose module injection or credential-like environment', () => {
  const { project, sbom } = fixture();
  const bin = join(project, 'bin');
  const envRecord = join(project, 'generator-env.json');
  fakePnpm(bin, envRecord);

  const generate = run(['generate', '--root', project, '--output', sbom], {
    ...process.env,
    PATH: bin,
    NODE_PATH: '/untrusted/modules',
    GPUGEEK_API_KEY: 'not-for-the-generator',
    __MISE_SESSION: 'not-for-the-generator',
  });

  assert.equal(generate.status, 0, generate.stderr);
  assert.deepEqual(JSON.parse(readFileSync(envRecord, 'utf8')), {});
});

test('release contract runs the SBOM freshness gate', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const releasing = readFileSync(join(root, 'RELEASING.md'), 'utf8');
  const workflow = readFileSync(join(root, '.github', 'workflows', 'publish.yml'), 'utf8');

  assert.match(manifest.scripts.sbom, /scripts\/sbom\.ts generate/);
  assert.match(manifest.scripts['sbom:check'], /scripts\/sbom\.ts check/);
  assert.match(manifest.scripts['release:check'], /pnpm run sbom:check/);
  assert.match(manifest.scripts.release, /scripts\/release-version\.ts/);
  assert.match(releasing, /regenerates the SBOM/);
  assert.match(workflow, /pnpm run sbom:check/);
  assert.match(workflow, /npm publish \.release-ci\/harnessmith-\*\.tgz/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);
});
