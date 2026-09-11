import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { bootstrapMetadataLimit, bootstrapProject } from '../commands/bootstrap/bootstrap.js';
import { initProject } from '../commands/init.js';
import { captureFinding } from '../commands/memory/memory-finding.js';
import { initTask } from '../commands/task/task.js';
import { readBootstrapMemory } from '../lib/bootstrap/bootstrap-memory.js';
import { memoryCoreHardByteLimit } from '../lib/memory/memory-core-budget.js';
import { projectSnapshot } from '../lib/project/project.js';
import { capturedIo, harnessRuntime, sourceHarnessRoot } from './helpers/harness.js';

function fixture({ git = true }: { git?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'harness-bootstrap-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  if (git) execFileSync('git', ['-C', project, 'init', '-q']);
  return { root, project, runtime: harnessRuntime(root) };
}

function tree(root: string): string[] {
  return readdirSync(root, { recursive: true, encoding: 'utf8' }).map(String).sort();
}

test('bootstrap distinguishes an uninitialized non-Git project without writing', () => {
  const { project, runtime } = fixture({ git: false });
  const before = tree(project);
  const report = bootstrapProject(runtime, project, { json: true }, capturedIo());
  assert.equal(report.version, 2);
  assert.equal(report.detail, 'brief');
  assert.equal(report.project.isGitRepository, false);
  assert.equal(report.memory.state, 'uninitialized');
  assert.equal('metadata' in report.memory, false);
  assert.deepEqual(report.tasks.active, []);
  assert.equal(report.truncated, false);
  assert.deepEqual(tree(project), before);
});

test('bootstrap aggregates dirty Git state, core pointers, maintenance, and multiple active tasks', () => {
  const { project, runtime } = fixture();
  initProject(runtime, project, capturedIo());
  initTask(
    runtime,
    { project, id: 'bootstrap-one', objective: 'First active task', acceptance: ['First passes'] },
    capturedIo(),
  );
  initTask(
    runtime,
    {
      project,
      id: 'bootstrap-two',
      objective: 'Second active task',
      acceptance: ['Second passes'],
    },
    capturedIo(),
  );
  writeFileSync(join(project, 'dirty.txt'), 'dirty');
  const before = tree(project);

  const report = bootstrapProject(runtime, project, { detail: 'full', json: true }, capturedIo());
  assert.equal(report.project.dirty, true);
  assert.equal(report.memory.state, 'valid');
  assert.equal(report.memory.core?.budget.status, 'ok');
  assert.equal(report.tasks.state, 'ok');
  assert.deepEqual(report.tasks.active.map(({ id }) => id).sort(), [
    'bootstrap-one',
    'bootstrap-two',
  ]);
  assert.ok(report.memory.recommended.every((reference) => reference.startsWith('memory:')));
  assert.ok(report.memory.maintenance);
  assert.deepEqual(tree(project), before);
});

test('bootstrap distinguishes partial, invalid, and over-budget Memory', () => {
  const partial = fixture();
  mkdirSync(join(partial.project, '.agent-docs'));
  writeFileSync(join(partial.project, '.agent-docs', 'README.md'), '# partial');
  assert.equal(
    bootstrapProject(partial.runtime, partial.project, { detail: 'full' }, capturedIo()).memory
      .state,
    'partial',
  );

  const invalid = fixture();
  initProject(invalid.runtime, invalid.project, capturedIo());
  const corePath = join(invalid.project, '.agent-docs', 'core.md');
  const core = readFileSync(corePath, 'utf8');
  writeFileSync(corePath, `${core}${'界'.repeat(Math.ceil(memoryCoreHardByteLimit / 3))}`);
  const report = bootstrapProject(
    invalid.runtime,
    invalid.project,
    { detail: 'full' },
    capturedIo(),
  );
  assert.equal(report.memory.state, 'inconclusive');
  assert.equal(report.memory.core?.budget.status, 'hard-limit');
  assert.ok(report.reasons.some((reason) => /budget/i.test(reason)));
});

test('bootstrap exposes fact semantics and reverification requirements', () => {
  const { project, runtime } = fixture();
  initProject(runtime, project, capturedIo());
  captureFinding(
    runtime,
    project,
    {
      kind: 'analysis',
      retention: 'workstream',
      factClass: 'current-state',
      title: 'Recheck current branch state',
      conclusion: 'The active branch state must be checked again before use.',
      rationale: 'Branch state changes during implementation.',
      application: 'Run the source verifier before making a branch-dependent decision.',
      evidence: ['The stored statement is intentionally temporary.'],
      sourceRefs: ['verifier:git status --short --branch'],
      workstream: 'bootstrap-fact-semantics',
      expires: '2026-09-30',
    },
    capturedIo(),
  );

  const finding = bootstrapProject(
    runtime,
    project,
    { detail: 'full' },
    capturedIo(),
  ).memory.metadata.find(({ type }) => type === 'analytical-finding');
  assert.equal(finding?.factClass, 'current-state');
  assert.equal(finding?.classification, 'explicit');
  assert.equal(finding?.requiresReverification, true);
});

test('bootstrap caps metadata and reports truncation without reading archive bodies', () => {
  const { project, runtime } = fixture();
  initProject(runtime, project, capturedIo());
  const memoryRoot = join(project, '.agent-docs');
  const date = '2026-08-31';
  for (let index = 0; index < bootstrapMetadataLimit + 2; index += 1) {
    const name = `working/note-${String(index).padStart(3, '0')}.md`;
    const path = join(memoryRoot, name);
    mkdirSync(join(memoryRoot, 'working'), { recursive: true });
    writeFileSync(
      path,
      `---\ntitle: Note ${index}\ndescription: Bounded metadata fixture\ntype: working-note\nmemory-kind: working\nstatus: active\nowners: [test-owner]\ncreated: ${date}\nupdated: ${date}\nexpires: 2026-09-30\nproject: project\ntags: [working]\nscope: []\nsource-refs: []\nsource-of-truth: false\nschema-version: 1\n---\n\n# Body marker ${index}\n`,
    );
  }
  const archive = join(memoryRoot, '_archive', 'hidden.md');
  mkdirSync(join(memoryRoot, '_archive'), { recursive: true });
  writeFileSync(archive, 'ARCHIVE_BODY_MUST_NOT_LOAD');

  const report = bootstrapProject(runtime, project, { detail: 'full' }, capturedIo());
  assert.equal(report.memory.metadata.length, bootstrapMetadataLimit);
  assert.equal(report.truncated, true);
  assert.ok(report.reasons.some((reason) => /metadata.*truncated/i.test(reason)));
  assert.doesNotMatch(JSON.stringify(report), /ARCHIVE_BODY_MUST_NOT_LOAD/);
});

test('bootstrap defaults to a compact brief and preserves full audit detail on request', () => {
  const { project, runtime } = fixture();
  initProject(runtime, project, capturedIo());
  for (let index = 0; index < 6; index += 1) {
    initTask(
      runtime,
      {
        project,
        id: `brief-task-${index}`,
        objective: `Resume task ${index}`,
        acceptance: [`Task ${index} passes`],
      },
      capturedIo(),
    );
  }

  const brief = bootstrapProject(runtime, project, { json: true }, capturedIo());
  const full = bootstrapProject(runtime, project, { detail: 'full', json: true }, capturedIo());

  assert.equal(brief.version, 2);
  assert.equal(brief.detail, 'brief');
  assert.equal('metadata' in brief.memory, false);
  assert.equal('core' in brief.memory, false);
  assert.equal('maintenance' in brief.memory, false);
  assert.equal(brief.tasks.active.length, 4);
  assert.deepEqual(brief.omitted, {
    sections: ['memory.metadata', 'memory.core', 'memory.maintenance'],
    activeTasks: 2,
    recommendations: 0,
  });

  assert.equal(full.detail, 'full');
  assert.ok(Array.isArray(full.memory.metadata));
  assert.ok(full.memory.core);
  assert.ok(full.memory.maintenance);
  assert.equal(full.tasks.active.length, 6);
  assert.deepEqual(full.omitted, { sections: [], activeTasks: 0, recommendations: 0 });
  assert.ok(JSON.stringify(brief).length < JSON.stringify(full).length / 2);
});

test('bootstrap reports invalid reads when initialized Memory changes after snapshot', () => {
  const { project, runtime } = fixture();
  initProject(runtime, project, capturedIo());
  const snapshot = projectSnapshot(project);
  const memoryRoot = join(project, '.agent-docs');
  rmSync(join(memoryRoot, 'core.md'));
  writeFileSync(join(memoryRoot, 'malformed.md'), '---\ntitle: [unterminated\n---\n');
  const reasons: string[] = [];

  const report = readBootstrapMemory(runtime, snapshot, reasons);

  assert.equal(report.state, 'invalid');
  assert.equal(report.core, null);
  assert.deepEqual(report.metadata, []);
  assert.equal(report.maintenance, null);
  assert.ok(reasons.some((reason) => /Core skipped/i.test(reason)));
  assert.ok(reasons.some((reason) => /metadata skipped/i.test(reason)));
  assert.ok(reasons.some((reason) => /maintenance skipped/i.test(reason)));
});

test('bootstrap folds documentation routing of the verbatim request into the startup command', () => {
  const { project, runtime: base } = fixture();
  const runtime = harnessRuntime(dirname(base.harnessHome), {
    docsRoot: join(sourceHarnessRoot, 'docs'),
  });
  initProject(runtime, project, capturedIo());

  const plain = bootstrapProject(runtime, project, { json: true }, capturedIo());
  assert.equal(plain.route, null);
  assert.equal(plain.skill, join(runtime.installedHarness, 'SKILL.md'));

  const io = capturedIo();
  const routed = bootstrapProject(runtime, project, { query: ['修复登录偶发失败的 bug'] }, io);
  assert.ok(routed.route);
  assert.equal(routed.route.status, 'matched');
  assert.equal(routed.route.intent.requested, 'change');
  assert.equal(routed.route.ask, null);
  assert.deepEqual(routed.route.load.slice(0, 2), [
    join(runtime.docsRoot, 'core', 'execution-loop.md'),
    join(runtime.docsRoot, 'playbooks', 'change.md'),
  ]);
  assert.equal(new Set(routed.route.load).size, routed.route.load.length);
  assert.ok(io.logs.some((line) => line === 'Route: matched change'));
  assert.ok(io.logs.some((line) => line.startsWith('Load: ')));

  const explicit = bootstrapProject(
    runtime,
    project,
    { query: ['评审 permissions 设计，用批判性思维'], intent: 'review' },
    capturedIo(),
  );
  assert.equal(explicit.route?.intent.source, 'explicit');
  assert.ok(explicit.route?.reasoningModes.length);
  assert.equal(
    explicit.route?.load.at(-1),
    join(runtime.docsRoot, 'references', 'reasoning-modes.md'),
  );

  const unmatched = bootstrapProject(runtime, project, { query: ['帮我看看这个'] }, capturedIo());
  assert.equal(unmatched.route?.status, 'unmatched');
  assert.deepEqual(unmatched.route?.load, []);
  assert.match(unmatched.route?.ask ?? '', /ask the user which action/);

  const ambiguous = bootstrapProject(
    runtime,
    project,
    { query: ['先评审这个模块，然后帮我修复并发布'] },
    capturedIo(),
  );
  if (ambiguous.route?.status === 'ambiguous') {
    assert.match(ambiguous.route.ask ?? '', /matches several playbooks/);
    assert.deepEqual(ambiguous.route.load, []);
  }

  // Same PEM envelope fixture as secret-hygiene.test.ts: no real credential shape.
  const privateKeyEnvelope = ['-----BEGIN', 'DSA PRIVATE KEY-----'].join(' ');
  assert.throws(
    () => bootstrapProject(runtime, project, { query: [privateKeyEnvelope] }, capturedIo()),
    /secret/i,
  );
});
