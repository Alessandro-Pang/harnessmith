import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { test } from 'vitest';
import { readNpmPackageTarball } from '../../scripts/npm-tarball.js';
import { run, temporaryDirectory } from './run-fixture.js';
import { candidateEntries, tarGzip, writeCandidateTarball } from './tarball-fixture.js';

const safePathSegment = fc.stringMatching(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,11}$/);
const safeRelativePath = fc
  .array(safePathSegment, { minLength: 1, maxLength: 4 })
  .map((segments) => segments.join('/'));

function paxPath(path: string): string {
  const payload = `path=${path}\n`;
  let length = Buffer.byteLength(payload) + 3;
  while (true) {
    const record = `${length} ${payload}`;
    const actual = Buffer.byteLength(record);
    if (actual === length) return record;
    length = actual;
  }
}

test('fingerprint rejects arbitrary bytes with a tgz suffix', () => {
  const artifact = join(temporaryDirectory(), 'arbitrary.tgz');
  writeFileSync(artifact, 'not an npm package');

  const result = run(['fingerprint', '--json', '--package-artifact', artifact]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /valid npm.*tgz|gzip|tarball/i);
});

test('fingerprint rejects a stale tarball instead of splicing in worktree versions', () => {
  const artifact = join(temporaryDirectory(), 'harnessmith-fixture.tgz');
  const scenarios = {
    schemaVersion: 2,
    scenarios: [
      {
        id: 'tarball-contract',
        prompt: 'Prompt from tarball.',
        setup: ['Tarball setup.'],
        pass: ['Tarball pass.'],
        forbidden: ['Tarball forbidden action.'],
        automatedChecks: ['fixture#check'],
      },
    ],
  };
  writeCandidateTarball(artifact, process.cwd(), {
    packageVersion: '9.8.7',
    harnessVersion: '7.6.5',
    rule: 'tarball-only-rule\n',
    scenarios,
  });

  const result = run(['fingerprint', '--json', '--package-artifact', artifact]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /name\/version does not match the release worktree/i);
});

test('fingerprint requires scenario catalog schemaVersion 3', () => {
  const artifact = join(temporaryDirectory(), 'scenario-schema-v1.tgz');
  const scenarios = JSON.parse(
    Buffer.from(
      candidateEntries(process.cwd()).find(({ path }) => path === 'package/evals/scenarios.json')
        ?.content ?? '',
    ).toString('utf8'),
  );
  scenarios.schemaVersion = 1;
  writeCandidateTarball(artifact, process.cwd(), { scenarios });

  const result = run(['fingerprint', '--json', '--package-artifact', artifact]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /evaluation scenarios violate schema.*schemaVersion/i);
});

test('fingerprint rejects distributed rules that do not match the release worktree', () => {
  const directory = temporaryDirectory();
  const first = join(directory, 'first.tgz');
  const second = join(directory, 'second.tgz');
  writeCandidateTarball(first, process.cwd());
  writeCandidateTarball(second, process.cwd(), { rule: 'second distributed rule\n' });

  const firstResult = run(['fingerprint', '--json', '--package-artifact', first]);
  const secondResult = run(['fingerprint', '--json', '--package-artifact', second]);

  assert.equal(firstResult.status, 0, firstResult.stderr);
  const fingerprint = JSON.parse(firstResult.stdout);
  assert.ok(fingerprint.ruleSources.includes('template/AGENTS.md'));
  assert.ok(fingerprint.ruleSources.includes('dist/cli.js'));
  assert.ok(!fingerprint.ruleSources.some((path: string) => path.startsWith('src/')));
  assert.equal(secondResult.status, 1);
  assert.match(secondResult.stderr, /distributed rules do not match the release worktree/i);
});

test('fingerprint rejects same-version package manifest drift', () => {
  const artifact = join(temporaryDirectory(), 'manifest-drift.tgz');
  const entries = candidateEntries(process.cwd());
  const manifestEntry = entries.find(({ path }) => path === 'package/package.json');
  assert.ok(manifestEntry);
  const manifest = JSON.parse(Buffer.from(manifestEntry.content).toString('utf8'));
  manifest.dependencies.commander = '0.0.0';
  manifestEntry.content = JSON.stringify(manifest);
  writeFileSync(artifact, tarGzip(entries));

  const result = run(['fingerprint', '--json', '--package-artifact', artifact]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /package manifest does not match the release worktree/i);
});

test('fingerprint rejects a candidate missing a declared package file', () => {
  const artifact = join(temporaryDirectory(), 'missing-declared-file.tgz');
  writeFileSync(
    artifact,
    tarGzip(candidateEntries(process.cwd()).filter(({ path }) => path !== 'package/llms.txt')),
  );

  const result = run(['fingerprint', '--json', '--package-artifact', artifact]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /package file set does not match|missing.*llms\.txt/i);
});

test('fingerprint rejects stale content in a non-rule package file', () => {
  const artifact = join(temporaryDirectory(), 'stale-guidance.tgz');
  const entries = candidateEntries(process.cwd());
  const guidance = entries.find(({ path }) => path === 'package/llms.txt');
  assert.ok(guidance);
  guidance.content = 'stale public guidance\n';
  writeFileSync(artifact, tarGzip(entries));

  const result = run(['fingerprint', '--json', '--package-artifact', artifact]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /package file content does not match.*llms\.txt/i);
});

test('fingerprint rejects undeclared extra package files', () => {
  const artifact = join(temporaryDirectory(), 'extra-file.tgz');
  writeFileSync(
    artifact,
    tarGzip([
      ...candidateEntries(process.cwd()),
      { path: 'package/undeclared.txt', content: 'not declared\n' },
    ]),
  );

  const result = run(['fingerprint', '--json', '--package-artifact', artifact]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /package file set does not match|unexpected.*undeclared\.txt/i);
});

test('fingerprint rejects unsafe and duplicate npm tar paths', () => {
  const directory = temporaryDirectory();
  const unsafe = join(directory, 'unsafe.tgz');
  const duplicate = join(directory, 'duplicate.tgz');
  const entries = candidateEntries(process.cwd());
  writeFileSync(
    unsafe,
    tarGzip([...entries, { path: 'package/../outside.txt', content: 'escape\n' }]),
  );
  writeFileSync(duplicate, tarGzip([...entries, entries[0]]));

  const unsafeResult = run(['fingerprint', '--json', '--package-artifact', unsafe]);
  const duplicateResult = run(['fingerprint', '--json', '--package-artifact', duplicate]);

  assert.equal(unsafeResult.status, 1);
  assert.match(unsafeResult.stderr, /unsafe npm tarball path/i);
  assert.equal(duplicateResult.status, 1);
  assert.match(duplicateResult.stderr, /duplicate npm tarball entry/i);
});

test('fingerprint rejects unsupported links and entries over the file budget', () => {
  const directory = temporaryDirectory();
  const linked = join(directory, 'linked.tgz');
  const oversized = join(directory, 'oversized.tgz');
  const entries = candidateEntries(process.cwd());
  writeFileSync(
    linked,
    tarGzip([
      ...entries,
      { path: 'package/link', content: '', linkpath: 'package/target', type: '2' },
    ]),
  );
  writeFileSync(
    oversized,
    tarGzip([
      ...entries,
      { path: 'package/large.bin', content: '', declaredSize: 128 * 1024 * 1024 + 1 },
    ]),
  );

  const linkResult = run(['fingerprint', '--json', '--package-artifact', linked]);
  const sizeResult = run(['fingerprint', '--json', '--package-artifact', oversized]);

  assert.equal(linkResult.status, 1);
  assert.match(linkResult.stderr, /unsupported npm tarball entry type/i);
  assert.equal(sizeResult.status, 1);
  assert.match(sizeResult.stderr, /file size limit exceeded/i);
});

test('fingerprint requires the npm tgz extension and core distribution files', () => {
  const directory = temporaryDirectory();
  const wrongExtension = join(directory, 'candidate.tar.gz');
  const incomplete = join(directory, 'incomplete.tgz');
  writeFileSync(wrongExtension, tarGzip(candidateEntries(process.cwd())));
  writeFileSync(
    incomplete,
    tarGzip(
      candidateEntries(process.cwd()).filter(
        ({ path }) => path !== 'package/template/agent-harness/dist/harness.mjs',
      ),
    ),
  );

  const extensionResult = run(['fingerprint', '--json', '--package-artifact', wrongExtension]);
  const incompleteResult = run(['fingerprint', '--json', '--package-artifact', incomplete]);

  assert.equal(extensionResult.status, 1);
  assert.match(extensionResult.stderr, /must be an npm \.tgz/i);
  assert.equal(incompleteResult.status, 1);
  assert.match(incompleteResult.stderr, /missing template\/agent-harness\/dist\/harness\.mjs/i);
});

test('fingerprint rejects a tarball with a corrupted header checksum', () => {
  const artifact = join(temporaryDirectory(), 'corrupted.tgz');
  const compressed = tarGzip(candidateEntries(process.cwd()));
  compressed[compressed.length - 8] ^= 0xff;
  writeFileSync(artifact, compressed);

  const result = run(['fingerprint', '--json', '--package-artifact', artifact]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /gzip|checksum|tarball|tgz/i);
});

test('fingerprint rejects candidate scenario contracts that differ from the release worktree', () => {
  const artifact = join(temporaryDirectory(), 'scenario.tgz');
  const scenarios = JSON.parse(
    readFileSync(join(process.cwd(), 'evals', 'scenarios.json'), 'utf8'),
  );
  scenarios.scenarios[0].prompt = 'Prompt from a different candidate contract.';
  writeCandidateTarball(artifact, process.cwd(), {
    scenarios,
  });

  const result = run(['fingerprint', '--json', '--package-artifact', artifact]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /evaluation scenarios do not match the release worktree/i);
});

test('fingerprint rejects a packaged evaluation run schema that differs from the release worktree', () => {
  const artifact = join(temporaryDirectory(), 'run-schema-drift.tgz');
  const entries = candidateEntries(process.cwd());
  const schema = JSON.parse(readFileSync(join(process.cwd(), 'evals', 'run.schema.json'), 'utf8'));
  schema.title = 'tampered schema';
  const schemaEntry = entries.find(({ path }) => path === 'package/evals/run.schema.json');
  assert.ok(schemaEntry);
  schemaEntry.content = JSON.stringify(schema);
  writeFileSync(artifact, tarGzip(entries));

  const result = run(['fingerprint', '--json', '--package-artifact', artifact]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /evaluation run schema does not match the release worktree/i);
});

test('fingerprint rejects a packaged scenario schema that differs from the release worktree', () => {
  const artifact = join(temporaryDirectory(), 'scenario-schema-drift.tgz');
  const entries = candidateEntries(process.cwd());
  const schema = JSON.parse(
    readFileSync(join(process.cwd(), 'evals', 'scenarios.schema.json'), 'utf8'),
  );
  schema.title = 'tampered schema';
  const schemaEntry = entries.find(({ path }) => path === 'package/evals/scenarios.schema.json');
  assert.ok(schemaEntry);
  schemaEntry.content = JSON.stringify(schema);
  writeFileSync(artifact, tarGzip(entries));

  const result = run(['fingerprint', '--json', '--package-artifact', artifact]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /evaluation scenario schema does not match the release worktree/i);
});

test('fingerprint accepts standard PAX path metadata produced by tar tooling', () => {
  const artifact = join(temporaryDirectory(), 'pax-path.tgz');
  const path = 'package/llms.txt';
  writeFileSync(
    artifact,
    tarGzip([
      ...candidateEntries(process.cwd()).filter((entry) => entry.path !== path),
      { path: 'package/PaxHeader', content: paxPath(path), type: 'x' },
      { path: 'package/placeholder', content: readFileSync(join(process.cwd(), 'llms.txt')) },
    ]),
  );

  const result = run(['fingerprint', '--json', '--package-artifact', artifact]);

  assert.equal(result.status, 0, result.stderr);
});

test('npm tarball path policy preserves generated safe package-relative files', () => {
  const artifact = join(temporaryDirectory(), 'property-paths.tgz');

  fc.assert(
    fc.property(safeRelativePath, (relativePath) => {
      const content = Buffer.from(`content:${relativePath}`);
      writeFileSync(artifact, tarGzip([{ path: `package/${relativePath}`, content }]));

      const tarball = readNpmPackageTarball(artifact);
      assert.deepEqual(tarball.files.get(relativePath), content);
    }),
  );
});

test('npm tarball path policy rejects traversal, absolute, empty, and platform paths', () => {
  const artifact = join(temporaryDirectory(), 'property-unsafe-paths.tgz');

  fc.assert(
    fc.property(safeRelativePath, (relativePath) => {
      for (const path of [
        `/${relativePath}`,
        `package/../${relativePath}`,
        `package/./${relativePath}`,
        `package//${relativePath}`,
        `package\\${relativePath}`,
        `package/\u0001${relativePath}`,
      ]) {
        writeFileSync(artifact, tarGzip([{ path, content: 'unsafe\n' }]));
        assert.throws(() => readNpmPackageTarball(artifact), /unsafe npm tarball path/i);
      }
    }),
  );
});
