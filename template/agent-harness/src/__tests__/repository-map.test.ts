import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import {
  discoverPackageRelations,
  maintainRepositoryMap,
  parseRepositoryMap,
  type RepositoryObservationSet,
  reconcileRepositoryMap,
  renderRepositoryMap,
  serializeRepositoryMap,
  validateRepositoryMap,
  verifyRepositoryMap,
} from '../lib/repository-map/repository-map.js';

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-repository-map-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function validMap() {
  return {
    schemaVersion: 1 as const,
    repositories: [
      {
        id: 'gateway',
        description: 'Routes public HTTP contracts to platform services.',
        checkout: 'platform/gateway',
        owns: ['public API routing'],
        aliases: ['api-gateway'],
        remotes: ['https://example.invalid/gateway.git'],
        sources: ['README.md'],
      },
      {
        id: 'account',
        description: 'Owns account identity and session contracts.',
        checkout: 'platform/account',
        owns: ['identity'],
        aliases: [],
        remotes: [],
        sources: ['README.md'],
      },
    ],
    relations: [
      {
        type: 'http-api' as const,
        provider: 'account',
        contract: '/account/v1/session',
        consumer: 'gateway',
        evidence: [
          { repository: 'account', side: 'provider' as const, path: 'routes/session.ts' },
          { repository: 'gateway', side: 'consumer' as const, path: 'config/routes.yaml' },
        ],
      },
    ],
  };
}

test('canonical repository map validates descriptions, direct edge direction, evidence, and keys', () => {
  const map = validMap();
  assert.equal(validateRepositoryMap(map).valid, true);

  const invalid = structuredClone(map);
  invalid.repositories[0].description = '';
  invalid.relations.push(structuredClone(invalid.relations[0]));
  invalid.relations[0].evidence = invalid.relations[0].evidence.slice(0, 1);
  invalid.relations[0].consumer = 'missing';
  const report = validateRepositoryMap(invalid);
  assert.equal(report.valid, false);
  assert.match(report.issues.join('\n'), /description/);
  assert.match(report.issues.join('\n'), /consumer.*missing/);
  assert.match(report.issues.join('\n'), /consumer evidence/);
  const duplicate = validMap();
  duplicate.relations.push(structuredClone(duplicate.relations[0]));
  assert.match(validateRepositoryMap(duplicate).issues.join('\n'), /Duplicate relation key/);
});

test('canonical YAML and Markdown projection are deterministic and omit verification state', () => {
  const map = validMap();
  const first = serializeRepositoryMap(map);
  const second = serializeRepositoryMap(parseRepositoryMap(first));
  assert.equal(second, first);

  const markdown = renderRepositoryMap(map);
  assert.match(markdown, /account → `\/account\/v1\/session` → gateway/);
  assert.match(markdown, /Owns account identity and session contracts/);
  assert.match(markdown, /routes\/session\.ts/);
  assert.doesNotMatch(markdown, /checkedAt|fingerprint|dirty|HEAD/);
  assert.equal(renderRepositoryMap(parseRepositoryMap(first)), markdown);
});

test('reconcile auto-applies only deterministic observations from trusted extractors', () => {
  const map = validMap();
  const result = reconcileRepositoryMap(
    map,
    {
      version: 1,
      extractor: { id: 'harness.package-manifest', version: '1' },
      repositories: [],
      relations: [
        {
          discovery: 'deterministic',
          type: 'package',
          provider: 'account',
          contract: '@example/account-client',
          consumer: 'gateway',
          evidence: [
            { repository: 'account', side: 'provider', path: 'package.json' },
            { repository: 'gateway', side: 'consumer', path: 'package.json' },
          ],
        },
        {
          discovery: 'heuristic',
          type: 'http-api',
          provider: 'gateway',
          contract: '/possibly-forwarded',
          consumer: 'account',
          evidence: [
            { repository: 'gateway', side: 'provider', path: 'README.md' },
            { repository: 'account', side: 'consumer', path: 'README.md' },
          ],
        },
      ],
    },
    { apply: true, trustedExtractors: ['harness.package-manifest'] },
  );
  assert.equal(result.appliedRelations.length, 1);
  assert.equal(result.proposals.length, 1);
  assert.equal(result.map.relations.length, 2);

  const repeated = reconcileRepositoryMap(result.map, result.observations, {
    apply: true,
    trustedExtractors: ['harness.package-manifest'],
  });
  assert.equal(repeated.appliedRelations.length, 0);
  assert.equal(repeated.unchangedRelations.length, 1);

  const untrusted = reconcileRepositoryMap(map, result.observations, {
    apply: true,
    trustedExtractors: [],
  });
  assert.equal(untrusted.appliedRelations.length, 0);
  assert.equal(untrusted.proposals.length, 2);

  const changedEvidence = structuredClone(result.observations);
  changedEvidence.relations = [
    {
      discovery: 'heuristic',
      ...structuredClone(map.relations[0]),
      evidence: [
        { repository: 'account', side: 'provider', path: 'routes/session-v2.ts' },
        { repository: 'gateway', side: 'consumer', path: 'config/routes.yaml' },
      ],
    },
  ];
  const changed = reconcileRepositoryMap(map, changedEvidence);
  assert.equal(changed.unchangedRelations.length, 0);
  assert.equal(changed.proposals.length, 1);

  const malformed = structuredClone(result.observations);
  malformed.relations[0].consumer = 'missing';
  assert.throws(() => reconcileRepositoryMap(map, malformed), /Invalid repository observations/);
});

test('verification fingerprints authoritative sources and maintenance reports drift and age', () => {
  const root = fixtureRoot();
  const map = validMap();
  for (const repository of map.repositories) {
    const checkout = join(root, repository.checkout);
    mkdirSync(checkout, { recursive: true });
    for (const source of repository.sources) writeFileSync(join(checkout, source), repository.id);
  }
  mkdirSync(join(root, 'platform/account/routes'), { recursive: true });
  mkdirSync(join(root, 'platform/gateway/config'), { recursive: true });
  writeFileSync(join(root, 'platform/account/routes/session.ts'), 'provider');
  writeFileSync(join(root, 'platform/gateway/config/routes.yaml'), 'consumer');

  const state = verifyRepositoryMap(map, root, {
    checkedAt: '2026-08-24T00:00:00.000Z',
    extractorVersion: 'repository-map.v1',
  });
  assert.equal(state.result, 'passed');
  assert.equal(state.sources.length, 4);
  assert.equal(state.misses.length, 0);
  assert.equal(
    maintainRepositoryMap(map, state, root, new Date('2026-08-25T00:00:00.000Z')).stale.length,
    0,
  );

  writeFileSync(join(root, 'platform/account/routes/session.ts'), 'changed');
  const drift = maintainRepositoryMap(map, state, root, new Date('2026-10-01T00:00:00.000Z'));
  assert.match(drift.stale.join('\n'), /verification is older than 30 days/);
  assert.match(drift.stale.join('\n'), /routes\/session\.ts.*fingerprint changed/);

  const statePath = join(root, 'verification.json');
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).version, 1);
});

test('validation enforces anti-bloat budgets and rejects transitive or volatile fields', () => {
  const map = validMap() as ReturnType<typeof validMap> & Record<string, unknown>;
  map.checkedAt = '2026-08-24';
  map.repositories[0].owns = Array.from({ length: 13 }, (_, index) => `scope-${index}`);
  const relation = map.relations[0] as (typeof map.relations)[number] & Record<string, unknown>;
  relation.transitive = true;
  const report = validateRepositoryMap(map);
  assert.equal(report.valid, false);
  assert.match(report.issues.join('\n'), /Unknown top-level field: checkedAt/);
  assert.match(report.issues.join('\n'), /owns.*12/);
  assert.match(report.issues.join('\n'), /Unknown relation field: transitive/);
});

test('validation rejects malformed catalog, relation, and evidence shapes fail-closed', () => {
  assert.match(validateRepositoryMap(null).issues.join('\n'), /must be an object/);
  const malformed = validMap() as unknown as Record<string, unknown>;
  malformed.extra = true;
  malformed.repositories = [
    null,
    {
      id: 'INVALID ID',
      description: '',
      checkout: '../escape',
      owns: Array.from({ length: 13 }, () => 'scope'),
      aliases: 'alias',
      remotes: Array.from({ length: 9 }, () => 'remote'),
      sources: [],
      extra: true,
    },
    {
      id: 'duplicate',
      description: 'one',
      checkout: 'one',
      owns: [],
      aliases: [],
      remotes: [],
      sources: ['README.md'],
    },
    {
      id: 'duplicate',
      description: 'two',
      checkout: 'two',
      owns: [],
      aliases: [],
      remotes: [],
      sources: ['../README.md'],
    },
  ];
  malformed.relations = [
    null,
    {
      type: 'unknown',
      provider: 'missing-provider',
      contract: '',
      consumer: 'missing-consumer',
      evidence: [
        null,
        {
          repository: 'missing',
          side: 'unknown',
          path: '../escape',
          extra: true,
        },
      ],
      extra: true,
    },
  ];
  const report = validateRepositoryMap(malformed);
  assert.equal(report.valid, false);
  assert.match(report.issues.join('\n'), /Unknown top-level field/);
  assert.match(report.issues.join('\n'), /Duplicate repository id/);
  assert.match(report.issues.join('\n'), /Unknown evidence field/);
  assert.match(report.issues.join('\n'), /missing provider evidence/);
  assert.match(report.issues.join('\n'), /missing consumer evidence/);

  const noArrays = validateRepositoryMap({ schemaVersion: 2 });
  assert.match(noArrays.issues.join('\n'), /schemaVersion must be 1/);
  assert.match(noArrays.issues.join('\n'), /repositories must be an array/);
  assert.match(noArrays.issues.join('\n'), /relations must be an array/);
});

test('reconcile validates and updates repository catalog observations', () => {
  const map = validMap();
  const repository = {
    discovery: 'deterministic' as const,
    id: 'search',
    description: 'Owns search contracts.',
    checkout: 'platform/search',
    owns: ['search'],
    aliases: [],
    remotes: [],
    sources: ['README.md'],
  };
  const observations: RepositoryObservationSet = {
    version: 1 as const,
    extractor: { id: 'trusted', version: '1' },
    repositories: [repository],
    relations: [],
  };
  const applied = reconcileRepositoryMap(map, observations, {
    apply: true,
    trustedExtractors: ['trusted'],
  });
  assert.deepEqual(applied.appliedRepositories, ['search']);
  const repeated = reconcileRepositoryMap(applied.map, observations, {
    apply: true,
    trustedExtractors: ['trusted'],
  });
  assert.deepEqual(repeated.unchangedRepositories, ['search']);

  const changed = structuredClone(observations);
  changed.repositories[0].description = 'Owns verified search and retrieval contracts.';
  assert.equal(reconcileRepositoryMap(applied.map, changed).proposals.length, 1);
  assert.deepEqual(
    reconcileRepositoryMap(applied.map, changed, {
      apply: true,
      trustedExtractors: ['trusted'],
    }).appliedRepositories,
    ['search'],
  );

  const heuristic = structuredClone(observations);
  heuristic.repositories[0].discovery = 'heuristic';
  assert.equal(
    reconcileRepositoryMap(map, heuristic, { apply: true, trustedExtractors: ['trusted'] })
      .proposals[0].reason,
    'manual-review',
  );
  const malformed = structuredClone(observations) as unknown as Record<string, unknown>;
  malformed.extra = true;
  assert.throws(
    () => reconcileRepositoryMap(map, malformed as never),
    /Invalid repository observation set/,
  );
  const invalidRepository = structuredClone(observations);
  invalidRepository.repositories[0].description = '';
  assert.throws(
    () => reconcileRepositoryMap(map, invalidRepository),
    /Invalid repository observations/,
  );
  const malformedRepository = structuredClone(observations) as unknown as {
    repositories: unknown[];
  };
  malformedRepository.repositories = [null];
  assert.throws(
    () => reconcileRepositoryMap(map, malformedRepository as never),
    /malformed repository observation/,
  );
  const malformedRelation = structuredClone(observations) as unknown as {
    relations: unknown[];
  };
  malformedRelation.relations = [null];
  assert.throws(
    () => reconcileRepositoryMap(map, malformedRelation as never),
    /malformed relation observation/,
  );
});

test('package discovery and maintenance expose ambiguity, missing sources, and invalid state', () => {
  const root = fixtureRoot();
  const map = validMap();
  map.repositories.push({
    id: 'duplicate-provider',
    description: 'Duplicates a package name for ambiguity testing.',
    checkout: 'platform/duplicate',
    owns: [],
    aliases: [],
    remotes: [],
    sources: ['README.md'],
  });
  for (const repository of map.repositories) {
    const checkout = join(root, repository.checkout);
    mkdirSync(checkout, { recursive: true });
    writeFileSync(join(checkout, 'README.md'), repository.id);
  }
  writeFileSync(
    join(root, 'platform/account/package.json'),
    JSON.stringify({ name: '@example/shared' }),
  );
  writeFileSync(
    join(root, 'platform/duplicate/package.json'),
    JSON.stringify({ name: '@example/shared' }),
  );
  writeFileSync(
    join(root, 'platform/gateway/package.json'),
    JSON.stringify({ dependencies: { '@example/shared': '1.0.0' } }),
  );
  const ambiguous = discoverPackageRelations(map, root);
  assert.match(ambiguous.skipped.join('\n'), /multiple local providers/);

  writeFileSync(join(root, 'platform/duplicate/package.json'), '{broken');
  assert.match(discoverPackageRelations(map, root).skipped.join('\n'), /(?:Expected|Unexpected)/);
  writeFileSync(join(root, 'platform/duplicate/package.json'), 'x'.repeat(1024 * 1024 + 1));
  assert.match(discoverPackageRelations(map, root).skipped.join('\n'), /within 1 MiB/);

  const missing = verifyRepositoryMap(map, root, {
    checkedAt: 'invalid',
    extractorVersion: 'test',
  });
  assert.equal(missing.result, 'failed');
  assert.match(missing.misses.join('\n'), /routes\/session\.ts/);
  const absent = maintainRepositoryMap(map, null, root);
  assert.match(absent.stale.join('\n'), /state is missing/);
  missing.sources = [];
  const invalidDate = maintainRepositoryMap(map, missing, root);
  assert.match(invalidDate.stale.join('\n'), /checkedAt is invalid/);
  assert.match(invalidDate.stale.join('\n'), /not present in verification state/);
});
