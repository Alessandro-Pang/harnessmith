import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { evaluationRegistry } from '../../scripts/evaluation/codex/eval-suite-registry.js';
import { evaluateCoverage } from '../../scripts/evaluation/contracts/eval-coverage.js';
import {
  applyMemoryFixtureSeeds,
  projectMemoryFixtures,
} from '../../scripts/evaluation/memory/memory-fixture-seed.js';
import { attestationCoverageMissing } from '../../scripts/release/release-attestation.js';

const root = join(import.meta.dirname, '..', '..');
const harness = join(root, 'template', 'skills', 'agent-harness', 'scripts', 'harness.mjs');

function disposable(): {
  repo: string;
  memory: string;
  personal: string;
  tempDir: string;
  env: NodeJS.ProcessEnv;
} {
  const home = mkdtempSync(join(tmpdir(), 'harness-memory-fixture-'));
  onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const repo = join(home, 'repo');
  const memory = join(home, 'memory');
  const personal = join(home, 'personal');
  const tempDir = join(home, 'tmp');
  mkdirSync(repo);
  mkdirSync(memory);
  mkdirSync(personal);
  mkdirSync(tempDir);
  const git = spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr);
  const env = {
    ...process.env,
    HOME: home,
    HARNESS_MEMORY_HOME: memory,
    HARNESS_PERSONAL_HOME: personal,
    HARNESS_REPOSITORY_ROOT: repo,
    HARNESS_OWNER: 'eval-fixture',
  };
  return { repo, memory, personal, tempDir, env };
}

function runHarness(env: NodeJS.ProcessEnv, cwd: string, argv: string[]): { stdout: string } {
  const result = spawnSync(process.execPath, [harness, ...argv], {
    cwd,
    encoding: 'utf8',
    env,
    timeout: 30_000,
  });
  const payload = argv.includes('--payload-file')
    ? readFileSync(argv[argv.indexOf('--payload-file') + 1], 'utf8')
    : '';
  assert.equal(
    result.status,
    0,
    `${argv.join(' ')}\n${result.stderr}\n${result.stdout}\n${payload}`,
  );
  return { stdout: result.stdout };
}

function markdownUnder(directory: string): string[] {
  const files: string[] = [];
  const walk = (path: string) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith('.md')) files.push(readFileSync(child, 'utf8'));
    }
  };
  walk(directory);
  return files;
}

function seedProject(name: string) {
  const fixture = disposable();
  runHarness(fixture.env, fixture.repo, ['init', 'global']);
  runHarness(fixture.env, fixture.repo, ['init', 'project', fixture.repo]);
  applyMemoryFixtureSeeds({
    globalMemory: 'empty',
    projectMemory: name,
    context: { repo: fixture.repo, tempDir: fixture.tempDir },
    run: (argv) => runHarness(fixture.env, fixture.repo, argv),
  });
  return { ...fixture, projectMemory: join(fixture.repo, '.agent-docs') };
}

test('every project fixture builds the precondition its operation needs', () => {
  for (const name of projectMemoryFixtures) {
    const { projectMemory } = seedProject(name);
    const docs = markdownUnder(projectMemory);
    if (name === 'empty' || name === 'experience-ready') {
      assert.ok(existsSync(join(projectMemory, 'core.md')), name);
      continue;
    }
    if (name === 'repairable-missing-readme') {
      assert.equal(existsSync(join(projectMemory, 'README.md')), false, name);
      continue;
    }
    if (name === 'active-handoff') {
      assert.ok(
        docs.some(
          (content) =>
            /type:\s*session-handoff/u.test(content) && /status:\s*active/u.test(content),
        ),
        name,
      );
      continue;
    }
    if (name === 'supersede-pair') {
      const inputs = docs.filter((content) => /memory-kind:\s*input/u.test(content));
      assert.ok(inputs.length >= 2, name);
      continue;
    }
    if (name === 'archivable-closed') {
      assert.ok(
        docs.some(
          (content) => /memory-kind:\s*input/u.test(content) && /status:\s*complete/u.test(content),
        ),
        name,
      );
      continue;
    }
    if (name === 'curation-candidates') {
      assert.ok(
        docs.some(
          (content) =>
            /memory-kind:\s*input/u.test(content) &&
            /retention:\s*workstream/u.test(content) &&
            /status:\s*active/u.test(content),
        ),
        name,
      );
      continue;
    }
    assert.ok(
      docs.some(
        (content) => /memory-kind:\s*input/u.test(content) && /status:\s*active/u.test(content),
      ),
      name,
    );
  }
});

test('memory operation coverage cells become executable after the fixtures are active', () => {
  const required = [
    'close-input',
    'capture-experience',
    'handoff',
    'close-handoff',
    'supersede',
    'archive',
    'maintain',
    'repair',
    'migrate',
    'curate',
    'curation-apply',
  ];
  const coverage = evaluateCoverage();
  for (const operation of required) {
    assert.ok(coverage.memory.executable.includes(`memory-operation:${operation}`), operation);
    assert.equal(
      coverage.memory.missing.includes(`memory-operation:${operation}`),
      false,
      operation,
    );
  }
  const registry = evaluationRegistry();
  for (const id of required) {
    assert.ok(
      registry.some(
        (entry) =>
          entry.implemented &&
          entry.sourceId === id &&
          entry.requirements.includes(`memory-operation:${id}`),
      ),
      id,
    );
  }
});

test('release attestation coverage.missing names the remaining unmeasured requirements', () => {
  assert.deepEqual(
    attestationCoverageMissing({
      memory: {
        missing: ['memory-operation:close-input'],
        unmeasured: ['memory-operation:handoff'],
      },
      scenarios: {
        missing: ['memory:writer-failure-recovery:0'],
        unmeasured: ['memory:maintain:0'],
      },
    }),
    [
      'memory-operation:close-input',
      'memory-operation:handoff',
      'memory:writer-failure-recovery:0',
      'memory:maintain:0',
    ],
  );
  const live = attestationCoverageMissing();
  assert.ok(
    live.some((id) => id.startsWith('memory-operation:')),
    'live attestation must still list unmeasured memory operations before a host run',
  );
});
