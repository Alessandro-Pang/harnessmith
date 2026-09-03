import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';

const root = process.cwd();

test('public curation apps/docs/site preserve explicit typed apply and acceptance boundaries', () => {
  const runtime = readFileSync(
    join(root, 'apps', 'docs', 'site', 'reference', 'runtime-cli.md'),
    'utf8',
  );
  const architecture = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'core', 'harness-cli-architecture.md'),
    'utf8',
  );
  const standard = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'standards', 'project-agent-docs.md'),
    'utf8',
  );
  const manifest = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'manifest.yaml'),
    'utf8',
  );

  for (const document of [runtime, architecture, standard]) {
    assert.match(document, /memory curate/);
    assert.match(document, /proposalId|proposal identity/i);
    assert.match(document, /source digest|sourceDigest/i);
    assert.match(document, /expire|expiresOn|过期/i);
    assert.match(document, /--yes/);
    assert.match(document, /partial/i);
    assert.match(document, /acceptance/i);
    assert.match(document, /typed lifecycle/i);
  }
  assert.match(architecture, /promotion.*proposal/i);
  assert.match(architecture, /不.*写.*事实源|does not write.*source of truth/i);
  assert.match(manifest, /curation-apply/);
  assert.match(manifest, /策展执行/);
});
