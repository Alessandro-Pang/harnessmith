import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { digestPath } from '../../../../packages/cli/src/shared/files.js';
import { runCli } from '../cli.js';
import { doctor } from '../commands/health/doctor.js';
import { initGlobal, initPersonal, initProject } from '../commands/init.js';
import { validate } from '../commands/validate.js';
import { render } from '../lib/filesystem/templates.js';
import { capturedIo, harnessRuntime, packageRoot, sourceHarnessRoot } from './helpers/harness.js';

function installedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-cli-unit-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  mkdirSync(runtime.harnessHome, { recursive: true });
  cpSync(sourceHarnessRoot, runtime.installedHarness, { recursive: true });
  const instructions = render(
    runtime,
    readFileSync(join(packageRoot, 'template', 'AGENTS.md'), 'utf8'),
  );
  writeFileSync(runtime.instructionFiles[0], instructions);
  initPersonal(runtime, capturedIo());
  initGlobal(runtime, capturedIo());
  return { root, runtime };
}

function healthMemoryDocument(
  title: string,
  { kind = 'evidence', status = 'complete', extra = '', body = '' } = {},
): string {
  return [
    '---',
    `title: ${title}`,
    `description: ${title} health fixture`,
    'type: evidence-manifest',
    `memory-kind: ${kind}`,
    `status: ${status}`,
    'owners: [test-owner]',
    'created: 2026-08-21',
    'updated: 2026-08-21',
    'project: global',
    'tags: [test]',
    'scope: []',
    'source-refs: []',
    'source-of-truth: false',
    extra,
    'schema-version: 1',
    '---',
    body,
  ]
    .filter(Boolean)
    .join('\n');
}

test('Harness CLI dispatches version and memory commands through injected IO', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-cli-dispatch-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  const version = capturedIo();
  assert.equal(runCli(['version'], { runtime, io: version }), 0);
  assert.deepEqual(version.logs, ['2.6.0']);
  assert.equal(runCli(['init', 'global'], { runtime, io: capturedIo() }), 0);
  assert.equal(runCli(['init', 'personal'], { runtime, io: capturedIo() }), 0);
  assert.equal(runCli(['memory', 'check', 'global'], { runtime, io: capturedIo() }), 0);
  assert.equal(
    runCli(['memory', 'check', 'global', '--indexed'], { runtime, io: capturedIo() }),
    0,
  );
  const maintenance = capturedIo();
  assert.equal(runCli(['memory', 'maintain', 'global', '--json'], { runtime, io: maintenance }), 0);
  assert.deepEqual(JSON.parse(maintenance.logs[0]).unindexed, []);
});

test('Harness search CLI emits bounded provenance-rich JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-search-cli-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(join(project, 'docs'), { recursive: true });
  writeFileSync(join(project, 'docs', 'context.md'), 'needle first\nneedle second\n');
  const runtime = harnessRuntime(root);
  const output = capturedIo();

  assert.equal(
    runCli(['search', '--project', project, '--limit', '1', '--json', 'needle'], {
      runtime,
      io: output,
    }),
    0,
  );
  const report = JSON.parse(output.logs[0]);
  assert.equal(report.matches.length, 1);
  assert.equal(report.truncated, true);
  assert.equal(report.matches[0].source, 'project-docs');
  assert.equal(report.matches[0].trust, 'untrusted');
});

test('Harness route CLI consumes manifest aliases without loading document bodies', () => {
  const { runtime } = installedFixture();
  const output = capturedIo();

  assert.equal(runCli(['route', '--json', 'review', 'permissions'], { runtime, io: output }), 0);
  const report = JSON.parse(output.logs[0]);
  assert.equal(report.version, 3);
  assert.equal(report.status, 'matched');
  assert.equal(report.top1.name, 'review');
  assert.ok(report.top1.matchedAliases.includes('review'));
  assert.equal(
    report.routes.some((route: { name: string }) => route.name === 'review'),
    true,
  );
  assert.equal(
    report.routes.some((route: { name: string }) => route.name === 'safety-and-verification'),
    true,
  );
  assert.equal(
    report.routes.every((route: { content?: string }) => route.content === undefined),
    true,
  );
});

test('Harness route CLI accepts a validated explicit documentation intent', () => {
  const { runtime } = installedFixture();
  const output = capturedIo();

  assert.equal(
    runCli(
      ['route', '--json', '--intent', 'research-and-design', '根据评审结果，形成对应的解决方案。'],
      { runtime, io: output },
    ),
    0,
  );
  const report = JSON.parse(output.logs[0]);
  assert.equal(report.intent.source, 'explicit');
  assert.equal(report.intent.requested, 'research-and-design');
  assert.equal(report.primaryPlaybook.name, 'research-and-design');
});

test.each([
  ['understand-and-map', '请梳理这个仓库的模块关系和调用链。'],
  ['verify-and-accept', '请验证这次修复是否满足验收条件。'],
])('Harness route CLI accepts the explicit %s documentation intent', (intent, query) => {
  const { runtime } = installedFixture();
  const output = capturedIo();

  assert.equal(runCli(['route', '--json', '--intent', intent, query], { runtime, io: output }), 0);
  const report = JSON.parse(output.logs[0]);
  assert.equal(report.intent.source, 'explicit');
  assert.equal(report.intent.requested, intent);
  assert.equal(report.primaryPlaybook.name, intent);
});

test('Harness route CLI fails closed for unmatched and ambiguous action intent', () => {
  const { runtime } = installedFixture();
  const unmatched = capturedIo();
  assert.equal(runCli(['route', '--json', 'digital'], { runtime, io: unmatched }), 2);
  assert.equal(JSON.parse(unmatched.logs[0]).status, 'unmatched');

  const ambiguous = capturedIo();
  assert.equal(
    runCli(['route', '--json', '请检查代码；请诊断失败'], { runtime, io: ambiguous }),
    2,
  );
  const report = JSON.parse(ambiguous.logs[0]);
  assert.equal(report.status, 'ambiguous');
  assert.equal(report.top1, null);
  assert.deepEqual(report.ambiguity, ['diagnose', 'review']);
});

test('Harness route CLI fails closed when a required topic exceeds the context budget', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-route-required-overflow-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const docsRoot = join(root, 'docs');
  mkdirSync(docsRoot, { recursive: true });
  writeFileSync(
    join(docsRoot, 'manifest.yaml'),
    `version: 1
entries:
  required-a:
    kind: topic
    path: required-a.md
    conceptAliases: [mandatory]
    requiredConceptAliases: [mandatory]
  required-b:
    kind: topic
    path: required-b.md
    conceptAliases: [mandatory]
    requiredConceptAliases: [mandatory]
  required-c:
    kind: topic
    path: required-c.md
    conceptAliases: [mandatory]
    requiredConceptAliases: [mandatory]
  required-d:
    kind: topic
    path: required-d.md
    conceptAliases: [mandatory]
    requiredConceptAliases: [mandatory]
  required-e:
    kind: topic
    path: required-e.md
    conceptAliases: [mandatory]
    requiredConceptAliases: [mandatory]
`,
  );
  const runtime = harnessRuntime(root, { docsRoot });
  const output = capturedIo();

  assert.equal(runCli(['route', '--json', 'mandatory'], { runtime, io: output }), 2);
  const report = JSON.parse(output.logs[0]);
  assert.deepEqual(
    report.omittedRequiredTopics.map(({ name }: { name: string }) => name),
    ['required-e'],
  );
});

test('Harness explain uses the same progressive-disclosure routing contract', () => {
  const { runtime } = installedFixture();
  const output = capturedIo();

  assert.equal(runCli(['explain', '--json', 'task-ledger'], { runtime, io: output }), 0);
  const report = JSON.parse(output.logs[0]);
  assert.deepEqual(
    report.routes.map(({ name }: { name: string }) => name),
    ['long-running-tasks'],
  );
  assert.equal(report.routes[0].content, undefined);
});

test('Harness memory search exposes the same bounded JSON contract', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-search-cli-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  writeFileSync(
    join(runtime.memoryHome, 'search.md'),
    healthMemoryDocument('Search memory', { body: 'needle first\nneedle second' }),
  );
  const output = capturedIo();

  assert.equal(
    runCli(['memory', 'search', 'global', '--limit', '1', '--json', 'needle'], {
      runtime,
      io: output,
    }),
    0,
  );
  const report = JSON.parse(output.logs[0]);
  assert.equal(report.matches.length, 1);
  assert.equal(report.truncated, true);
  assert.equal(report.matches[0].source, 'memory');
  assert.equal(report.matches[0].trust, 'untrusted');
});

test('Harness memory list and check expose stable JSON contracts', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-json-cli-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());

  const listed = capturedIo();
  assert.equal(runCli(['memory', 'list', 'global', '--json'], { runtime, io: listed }), 0);
  const listReport = JSON.parse(listed.logs[0]);
  assert.equal(listReport.version, 1);
  assert.equal(
    listReport.documents.some((document: { path: string }) => document.path === 'core.md'),
    true,
  );

  const checked = capturedIo();
  assert.equal(
    runCli(['memory', 'check', 'global', '--indexed', '--json'], { runtime, io: checked }),
    0,
  );
  const checkReport = JSON.parse(checked.logs[0]);
  assert.equal(checkReport.version, 1);
  assert.equal(checkReport.valid, true);
  assert.equal(checkReport.indexed, true);
});

test('Harness version exposes its schema compatibility contract as JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-version-contract-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const runtime = harnessRuntime(root);
  const output = capturedIo();

  assert.equal(runCli(['version', '--json'], { runtime, io: output }), 0);
  const contract = JSON.parse(output.logs[0]);
  assert.equal(contract.version, 1);
  assert.equal(contract.harnessVersion, '2.6.0');
  assert.equal(contract.schemaVersion, 3);
  assert.equal(contract.memorySchemaVersion, 1);
  assert.equal(contract.node, '>=24.12.0');
});

test('validation rejects an unsupported embedded memory schema version', () => {
  const { runtime } = installedFixture();
  const manifestPath = join(runtime.installedHarness, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.memorySchemaVersion = 99;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const output = capturedIo();

  assert.equal(validate(runtime, { json: true }, output), 1);
  const report = JSON.parse(output.logs[0]);
  assert.equal(report.valid, false);
  assert.equal(
    report.checks.some(
      (check: { id: string; status: string }) =>
        check.id === 'harness-manifest' && check.status === 'failed',
    ),
    true,
  );
});

test('doctor and validate pass for an installed fixture and report missing prerequisites', () => {
  const { root, runtime } = installedFixture();
  const healthy = capturedIo();
  doctor(runtime, {}, healthy);
  assert.match(healthy.logs.at(-1) ?? '', /Doctor passed/);

  const validation = capturedIo();
  assert.equal(validate(runtime, { json: true }, validation), 0);
  assert.equal((JSON.parse(validation.logs[0]) as { valid: boolean }).valid, true);

  const broken = harnessRuntime(join(root, 'broken'));
  assert.throws(() => doctor(broken, { quietSuccess: true }, capturedIo()), /failure/);

  rmSync(join(runtime.memoryHome, 'profile.md'));
  const missingProfile = capturedIo();
  assert.throws(() => doctor(runtime, { quietSuccess: true }, missingProfile), /failure/);
  assert.equal(
    missingProfile.logs.some((line) => /FAIL global user profile/.test(line)),
    true,
  );
});

test('Harness health aggregates runtime, installation, and memory checks as JSON', () => {
  const { root, runtime } = installedFixture();
  const project = join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['-C', project, 'init', '-q']);
  initProject(runtime, project, capturedIo());
  const output = capturedIo();

  assert.equal(runCli(['health', '--project', project, '--json'], { runtime, io: output }), 0);
  const report = JSON.parse(output.logs[0]);
  assert.equal(report.version, 1);
  assert.equal(report.healthy, true);
  assert.deepEqual(
    report.checks.map((check: { id: string }) => check.id),
    ['runtime', 'installation', 'global-memory', 'audit', 'project-memory'],
  );

  rmSync(join(project, '.agent-docs', '.ignore'));
  const broken = capturedIo();
  assert.equal(runCli(['health', '--project', project, '--json'], { runtime, io: broken }), 1);
  const projectMemory = JSON.parse(broken.logs[0]).checks.find(
    ({ id }: { id: string }) => id === 'project-memory',
  );
  assert.equal(projectMemory.status, 'failed');
  assert.equal(
    projectMemory.details.some((detail: string) => detail.includes('.ignore')),
    true,
  );

  writeFileSync(join(runtime.installedHarness, 'manifest.json'), '{}\n');
  const incompatible = capturedIo();
  assert.equal(runCli(['health', '--json'], { runtime, io: incompatible }), 1);
  const installation = JSON.parse(incompatible.logs[0]).checks.find(
    ({ id }: { id: string }) => id === 'installation',
  );
  assert.equal(installation.status, 'failed');
  assert.match(installation.message, /schema is incompatible/);
});

test('Harness health verifies managed output checksums for installed host adapters', () => {
  const fixture = installedFixture();
  const runtime = {
    ...fixture.runtime,
    hostAdapter: 'managed-host',
    harnessRoot: fixture.runtime.installedHarness,
    distributionRoot: fixture.runtime.harnessHome,
  };
  writeFileSync(
    join(runtime.harnessRoot, 'install-context.json'),
    `${JSON.stringify({
      version: 1,
      adapter: runtime.hostAdapter,
      harnessHome: runtime.harnessHome,
      instructionFiles: runtime.instructionFiles,
      memoryHome: runtime.memoryHome,
      personalHome: runtime.personalHome,
      repositoryRoot: runtime.repositoryRoot,
      owner: runtime.owner,
    })}\n`,
  );
  const recordPath = join(runtime.harnessHome, '.harnessmith', 'install.json');
  mkdirSync(join(runtime.harnessHome, '.harnessmith'), { recursive: true });
  const record = {
    schemaVersion: 1,
    adapter: 'managed-host',
    outputs: [
      {
        path: runtime.installedHarness,
        checksum: digestPath(runtime.installedHarness, {
          exclude: (relativePath) => relativePath.split(/[\\/]/)[0] === 'state',
        }),
        backup: null,
      },
      {
        path: runtime.instructionFiles[0],
        checksum: digestPath(runtime.instructionFiles[0]),
        backup: null,
      },
    ],
    ignoreFiles: [],
    recordBackup: null,
  };
  const writeRecord = (): void => writeFileSync(recordPath, `${JSON.stringify(record)}\n`);
  writeRecord();
  const initial = capturedIo();
  assert.equal(runCli(['health', '--json'], { runtime, io: initial }), 0, initial.logs.join('\n'));

  record.outputs[1].checksum = null;
  writeRecord();
  assert.equal(runCli(['health', '--json'], { runtime, io: capturedIo() }), 1);
  record.outputs[1].checksum = digestPath(runtime.instructionFiles[0]);
  writeRecord();

  writeFileSync(runtime.instructionFiles[0], 'tampered instructions\n');
  const output = capturedIo();
  assert.equal(runCli(['health', '--json'], { runtime, io: output }), 1);
  const installation = JSON.parse(output.logs[0]).checks.find(
    ({ id }: { id: string }) => id === 'installation',
  );
  assert.equal(installation.status, 'failed');
  assert.equal(
    installation.details.some((detail: string) => detail.includes('modified')),
    true,
  );
});

test('Harness health reports memory maintenance candidates and validation failures', () => {
  const { runtime } = installedFixture();
  const expired = join(runtime.memoryHome, 'expired.md');
  const warning = join(runtime.memoryHome, 'warning.md');
  writeFileSync(
    expired,
    healthMemoryDocument('Expired', {
      kind: 'working',
      status: 'active',
      extra: 'expires: 2000-01-01',
    }),
  );
  writeFileSync(warning, healthMemoryDocument('Warning', { kind: 'working', status: 'active' }));
  writeFileSync(join(runtime.memoryHome, 'closed.md'), healthMemoryDocument('Closed'));
  const core = join(runtime.memoryHome, 'core.md');
  writeFileSync(core, `${readFileSync(core, 'utf8')}\n- memory:expired\n- memory:warning\n`);

  const maintenance = capturedIo();
  assert.equal(runCli(['health', '--json'], { runtime, io: maintenance }), 0);
  const globalMemory = JSON.parse(maintenance.logs[0]).checks.find(
    ({ id }: { id: string }) => id === 'global-memory',
  );
  assert.equal(globalMemory.status, 'warning');
  assert.equal(
    globalMemory.details.some((detail: string) => detail.startsWith('expired:')),
    true,
  );
  assert.equal(
    globalMemory.details.some((detail: string) => detail.startsWith('archive candidate:')),
    true,
  );

  writeFileSync(
    join(runtime.memoryHome, 'invalid.md'),
    healthMemoryDocument('Invalid', {
      body: ['npm', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('_'),
    }),
  );
  const invalid = capturedIo();
  assert.equal(runCli(['health', '--json'], { runtime, io: invalid }), 1);
  const failedMemory = JSON.parse(invalid.logs[0]).checks.find(
    ({ id }: { id: string }) => id === 'global-memory',
  );
  assert.equal(failedMemory.status, 'failed');
  assert.equal(
    failedMemory.details.some((detail: string) => detail.includes('secret')),
    true,
  );
});
