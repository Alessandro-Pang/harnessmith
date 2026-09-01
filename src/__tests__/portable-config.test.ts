import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { onTestFinished, test } from 'vitest';
import {
  applyPortableConfigImport,
  createPortableConfigBundle,
  planPortableConfigImport,
  writePortableConfigBundle,
} from '../portable-config.js';
import {
  executePortableConfigExport,
  executePortableConfigImport,
} from '../portable-config-command.js';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const schema = JSON.parse(
  readFileSync(join(packageRoot, 'portable-config', 'bundle.schema.json'), 'utf8'),
);

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    env: {
      ...process.env,
      HOME: root,
      HARNESS_PERSONAL_HOME: join(root, '个人-harness'),
    },
  };
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

test('export includes only allowlisted personal overlay files and excludes secrets', () => {
  const { root, env } = fixture('harnessmith-portable-export-');
  const personal = env.HARNESS_PERSONAL_HOME;
  const secret = ['ghp', '_', 'E'.repeat(24)].join('');
  write(join(personal, 'AGENTS.md'), '# 我的规则\n');
  write(join(personal, 'projects', 'repository-map.yaml'), 'version: 1\nrepositories: []\n');
  write(join(personal, 'projects', 'repository-map.md'), `private ${secret}\n`);
  write(join(personal, 'state', 'cache.json'), `{"secret":"${secret}"}\n`);
  write(join(root, 'workspace.txt'), 'arbitrary workspace content\n');

  const bundle = createPortableConfigBundle({ env });
  const serialized = JSON.stringify(bundle);

  assert.deepEqual(
    bundle.resources.map(({ path }) => path),
    ['AGENTS.md', 'projects/repository-map.yaml'],
  );
  assert.ok(
    bundle.exclusions.some(
      ({ path, reasonCode }) =>
        path === 'projects/repository-map.md' && reasonCode === 'SECRET_DETECTED',
    ),
  );
  assert.doesNotMatch(serialized, new RegExp(secret));
  assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(serialized, /cache\.json|workspace\.txt/);
  assert.deepEqual(bundle.excludedCategories, [
    'managed-distribution',
    'mutable-state',
    'global-memory',
    'project-memory',
    'host-credentials',
    'cache-and-temporary-files',
    'workspace-content',
  ]);
});

test('export and import round-trip allowed data through a proposal-bound transaction', () => {
  const source = fixture('harnessmith-portable-source-');
  const target = fixture('harnessmith-portable-target-');
  write(join(source.env.HARNESS_PERSONAL_HOME, 'AGENTS.md'), '# 可迁移规则\n中文内容\n');
  write(
    join(source.env.HARNESS_PERSONAL_HOME, 'projects', 'repository-map.yaml'),
    'version: 1\nrepositories: []\n',
  );
  const bundle = createPortableConfigBundle({ env: source.env });
  const bundlePath = join(source.root, 'bundle.json');
  writePortableConfigBundle(bundlePath, bundle);

  const plan = planPortableConfigImport(bundlePath, { env: target.env });
  assert.equal(plan.applied, false);
  assert.ok(plan.changes.every(({ action }) => action === 'create'));
  const result = applyPortableConfigImport(bundlePath, plan.proposalId, { env: target.env });

  assert.equal(result.applied, true);
  assert.equal(
    readFileSync(join(target.env.HARNESS_PERSONAL_HOME, 'AGENTS.md'), 'utf8'),
    '# 可迁移规则\n中文内容\n',
  );
  assert.equal(
    readFileSync(join(target.env.HARNESS_PERSONAL_HOME, 'projects', 'repository-map.yaml'), 'utf8'),
    'version: 1\nrepositories: []\n',
  );
});

test('import refuses changed targets and stale proposals without overwriting user content', () => {
  const source = fixture('harnessmith-portable-conflict-source-');
  const target = fixture('harnessmith-portable-conflict-target-');
  write(join(source.env.HARNESS_PERSONAL_HOME, 'AGENTS.md'), '# imported\n');
  const bundlePath = join(source.root, 'bundle.json');
  writePortableConfigBundle(bundlePath, createPortableConfigBundle({ env: source.env }));
  const plan = planPortableConfigImport(bundlePath, { env: target.env });
  const destination = join(target.env.HARNESS_PERSONAL_HOME, 'AGENTS.md');
  write(destination, '# local edit\n');

  assert.throws(
    () => applyPortableConfigImport(bundlePath, plan.proposalId, { env: target.env }),
    /proposal changed/,
  );
  assert.equal(readFileSync(destination, 'utf8'), '# local edit\n');
  const conflict = planPortableConfigImport(bundlePath, { env: target.env });
  assert.equal(conflict.changes[0].action, 'conflict');
  assert.throws(
    () => applyPortableConfigImport(bundlePath, conflict.proposalId, { env: target.env }),
    /adopt flow/,
  );
});

test('import rejects unknown schema, tampering, traversal, and symlink input', () => {
  const source = fixture('harnessmith-portable-invalid-source-');
  const target = fixture('harnessmith-portable-invalid-target-');
  write(join(source.env.HARNESS_PERSONAL_HOME, 'AGENTS.md'), '# safe\n');
  const bundle = createPortableConfigBundle({ env: source.env });
  const bundlePath = join(source.root, 'bundle.json');

  write(bundlePath, `${JSON.stringify({ ...bundle, schemaVersion: 2 })}\n`);
  assert.throws(() => planPortableConfigImport(bundlePath, { env: target.env }), /schema version/);

  write(bundlePath, `${JSON.stringify({ ...bundle, bundleDigest: 'sha256:bad' })}\n`);
  assert.throws(() => planPortableConfigImport(bundlePath, { env: target.env }), /digest/);

  const traversal = {
    ...bundle,
    resources: [{ ...bundle.resources[0], path: '../escape.md' }],
  };
  write(bundlePath, `${JSON.stringify(traversal)}\n`);
  assert.throws(() => planPortableConfigImport(bundlePath, { env: target.env }), /resource path/);

  const realPath = join(source.root, 'real-bundle.json');
  write(realPath, `${JSON.stringify(bundle)}\n`);
  const linkPath = join(source.root, 'linked-bundle.json');
  symlinkSync(realPath, linkPath);
  assert.throws(() => planPortableConfigImport(linkPath, { env: target.env }), /symbolic link/);

  const outside = join(target.root, 'outside.md');
  write(outside, '# outside\n');
  const linkedTarget = join(target.env.HARNESS_PERSONAL_HOME, 'AGENTS.md');
  mkdirSync(dirname(linkedTarget), { recursive: true });
  symlinkSync(outside, linkedTarget);
  assert.throws(() => planPortableConfigImport(realPath, { env: target.env }), /symbolic link/);
});

test('import rolls back all created files when a transaction fails', () => {
  const source = fixture('harnessmith-portable-rollback-source-');
  const target = fixture('harnessmith-portable-rollback-target-');
  write(join(source.env.HARNESS_PERSONAL_HOME, 'AGENTS.md'), '# first\n');
  write(join(source.env.HARNESS_PERSONAL_HOME, 'projects', 'repository-map.yaml'), 'version: 1\n');
  const bundlePath = join(source.root, 'bundle.json');
  writePortableConfigBundle(bundlePath, createPortableConfigBundle({ env: source.env }));
  const plan = planPortableConfigImport(bundlePath, { env: target.env });

  assert.throws(
    () =>
      applyPortableConfigImport(bundlePath, plan.proposalId, {
        env: target.env,
        afterWrite: ({ index }) => {
          if (index === 0) throw new Error('injected failure');
        },
      }),
    /injected failure/,
  );
  assert.equal(existsSync(join(target.env.HARNESS_PERSONAL_HOME, 'AGENTS.md')), false);
  assert.equal(
    existsSync(join(target.env.HARNESS_PERSONAL_HOME, 'projects', 'repository-map.yaml')),
    false,
  );
});

test('portable config bundle matches its closed versioned schema', () => {
  const { env } = fixture('harnessmith-portable-schema-');
  write(join(env.HARNESS_PERSONAL_HOME, 'AGENTS.md'), '# schema\n');
  const bundle = createPortableConfigBundle({ env });
  const ajv = new Ajv2020({ allErrors: true, strict: true });

  assert.equal(ajv.validate(schema, bundle), true, JSON.stringify(ajv.errors));
  assert.equal(ajv.validate(schema, { ...bundle, credential: 'forbidden' }), false);
});

test('version fixtures preserve v1 compatibility and fail closed on unsupported versions', () => {
  const target = fixture('harnessmith-portable-version-target-');
  const fixtureRoot = join(packageRoot, 'src', '__tests__', 'fixtures', 'portable-config');

  const plan = planPortableConfigImport(join(fixtureRoot, 'v1.json'), { env: target.env });
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.changes[0].action, 'create');
  assert.throws(
    () => planPortableConfigImport(join(fixtureRoot, 'unsupported-v2.json'), { env: target.env }),
    /schema version/,
  );
});

test('CLI handlers preview export and require an exact proposal before import', () => {
  const source = fixture('harnessmith-portable-command-source-');
  const target = fixture('harnessmith-portable-command-target-');
  write(join(source.env.HARNESS_PERSONAL_HOME, 'AGENTS.md'), '# command\n');
  const bundlePath = join(source.root, 'bundle.json');
  const exportLogs: string[] = [];
  assert.equal(
    executePortableConfigExport(
      { agent: [], project: source.root, output: bundlePath, json: true },
      { env: source.env, io: { log: (value) => exportLogs.push(String(value)) } },
    ),
    0,
  );
  assert.equal(JSON.parse(exportLogs[0]).kind, 'harnessmith-portable-config');

  const previewLogs: string[] = [];
  assert.equal(
    executePortableConfigImport(
      { agent: [], project: target.root, input: bundlePath, json: true },
      { env: target.env, io: { log: (value) => previewLogs.push(String(value)) } },
    ),
    0,
  );
  const proposalId = JSON.parse(previewLogs[0]).proposalId;
  assert.throws(
    () =>
      executePortableConfigImport(
        { agent: [], project: target.root, input: bundlePath, yes: true },
        { env: target.env, io: { log: () => undefined } },
      ),
    /requires --proposal/,
  );
  assert.equal(
    executePortableConfigImport(
      { agent: [], project: target.root, input: bundlePath, proposal: proposalId, yes: true },
      { env: target.env, io: { log: () => undefined } },
    ),
    0,
  );
  assert.equal(
    readFileSync(join(target.env.HARNESS_PERSONAL_HOME, 'AGENTS.md'), 'utf8'),
    '# command\n',
  );
});
