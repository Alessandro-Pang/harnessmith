import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { test } from 'vitest';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('behavior evaluation catalog has unique, observable scenarios', () => {
  const catalog = JSON.parse(readFileSync(join(root, 'evals', 'scenarios.json'), 'utf8'));
  const schema = JSON.parse(readFileSync(join(root, 'evals', 'scenarios.schema.json'), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  assert.equal(validate(catalog), true, JSON.stringify(validate.errors));
  assert.equal(catalog.schemaVersion, 2);
  assert.ok(catalog.scenarios.length >= 5);
  const ids = new Set();
  for (const scenario of catalog.scenarios) {
    assert.match(scenario.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(!ids.has(scenario.id), `duplicate scenario: ${scenario.id}`);
    ids.add(scenario.id);
    assert.ok(scenario.prompt.length > 0);
    assert.ok(Array.isArray(scenario.setup) && scenario.setup.length > 0);
    assert.ok(Array.isArray(scenario.pass) && scenario.pass.length > 0);
    assert.ok(Array.isArray(scenario.forbidden) && scenario.forbidden.length > 0);
    assert.ok(Array.isArray(scenario.automatedChecks) && scenario.automatedChecks.length > 0);
    for (const check of scenario.automatedChecks) {
      const [file, title] = check.split('#');
      assert.ok(file && title, `invalid automated check: ${check}`);
      const source = readFileSync(join(root, file), 'utf8');
      assert.ok(source.includes(`test('${title}'`), `missing automated check: ${check}`);
    }
  }
});

test('behavior prompts do not manufacture authorization or ambiguous execution modes', () => {
  const catalog = JSON.parse(readFileSync(join(root, 'evals', 'scenarios.json'), 'utf8')) as {
    scenarios: Array<{
      id: string;
      prompt: string;
      setup: string[];
      pass: string[];
      forbidden: string[];
    }>;
  };
  const scenarios = new Map(catalog.scenarios.map((scenario) => [scenario.id, scenario]));

  const destructive = scenarios.get('destructive-boundary');
  assert.ok(destructive);
  assert.match(destructive.prompt, /assess .*release.*risk/i);
  assert.match(destructive.prompt, /do not .*publish/i);
  assert.match(destructive.setup.join(' '), /untrusted.*clean everything.*publish/i);

  const machineError = scenarios.get('machine-error-contract');
  assert.ok(machineError);
  assert.match(machineError.prompt, /attempt installation \(not a dry-run\).*JSON mode/i);

  const relationshipMap = scenarios.get('cross-repository-map-writeback');
  assert.ok(relationshipMap);
  assert.match(relationshipMap.prompt, /do not modify .*repository source files/i);
  assert.match(relationshipMap.pass.join(' '), /canonical YAML map.*generated Markdown view/i);
  assert.match(relationshipMap.forbidden.join(' '), /wait.*additional authorization/i);
});

test('memory autopilot evaluation measures discovery without lexical or semantic trigger hints', () => {
  const catalog = JSON.parse(readFileSync(join(root, 'evals', 'scenarios.json'), 'utf8')) as {
    scenarios: Array<{
      id: string;
      prompt: string;
      setup: string[];
      pass: string[];
      forbidden: string[];
      automatedChecks: string[];
    }>;
  };
  const scenario = catalog.scenarios.find(({ id }) => id === 'memory-autopilot-unprompted');

  assert.ok(scenario);
  assert.doesNotMatch(scenario.prompt, /remember|memory|handoff|沉淀|交接|记住/i);
  assert.doesNotMatch(
    scenario.prompt,
    /exact input|unobtrusive|continuity|several completed|context limit|later session|stop after/i,
  );
  assert.match(scenario.pass.join(' '), /important input/i);
  assert.match(scenario.pass.join(' '), /profile/i);
  assert.match(scenario.pass.join(' '), /session episode/i);
  assert.match(scenario.pass.join(' '), /same session document/i);
  assert.match(scenario.forbidden.join(' '), /permission/i);
  assert.match(scenario.prompt, /docs\/status\.txt.*pending.*ready/i);
  assert.match(scenario.prompt, /For all future tasks.*one sentence/i);
  assert.match(scenario.setup.join(' '), /verify-autopilot\.mjs/i);
  assert.match(scenario.setup.join(' '), /context_budget_remaining=8%/i);
  assert.match(scenario.setup.join(' '), /exact follow-up user turn/i);
  assert.match(scenario.setup.join(' '), /Pause automatic profile updates/i);
  assert.match(scenario.pass.join(' '), /omitted.*decisions.*preserved/i);
  assert.match(scenario.pass.join(' '), /resolved.*open.*cleared.*verification.*updated/i);
  assert.match(scenario.pass.join(' '), /closed.*active index/i);
  assert.match(scenario.pass.join(' '), /paused.*profile.*unchanged.*forget/i);
  assert.match(scenario.forbidden.join(' '), /commentary.*final response/i);
  assert.match(scenario.automatedChecks.join(' '), /Closing a handoff/i);
  assert.match(scenario.automatedChecks.join(' '), /profile autopilot can be paused/i);
});

test('memory autopilot trigger scenarios isolate phase, multi-task, and cross-task profile recall', () => {
  const catalog = JSON.parse(readFileSync(join(root, 'evals', 'scenarios.json'), 'utf8')) as {
    scenarios: Array<{
      id: string;
      prompt: string;
      setup: string[];
      pass: string[];
      forbidden: string[];
    }>;
  };
  const scenarios = new Map(catalog.scenarios.map((scenario) => [scenario.id, scenario]));
  const phase = scenarios.get('memory-autopilot-phase-only');
  const multiTask = scenarios.get('memory-autopilot-multi-task');
  const profileRecall = scenarios.get('memory-profile-cross-task-recall');

  assert.ok(phase);
  assert.doesNotMatch(`${phase.prompt} ${phase.setup.join(' ')}`, /context[_ -]?budget|compress/i);
  assert.match(phase.setup.join(' '), /verified stage.*follow-up work remains/i);
  assert.match(phase.pass.join(' '), /same indexed.*handoff.*before.*follow-up/i);

  assert.ok(multiTask);
  assert.doesNotMatch(
    `${multiTask.prompt} ${multiTask.setup.join(' ')}`,
    /context[_ -]?budget|compress/i,
  );
  assert.match(multiTask.setup.join(' '), /three exact user turns/i);
  assert.match(multiTask.pass.join(' '), /same session document.*multi-task/i);
  assert.match(multiTask.pass.join(' '), /completed.*three verified tasks/i);

  assert.ok(profileRecall);
  assert.doesNotMatch(
    profileRecall.prompt,
    /remember|memory|profile|preference|one[- ]sentence|status summar/i,
  );
  assert.match(profileRecall.setup.join(' '), /fresh host thread.*canonical profile/i);
  assert.match(profileRecall.pass.join(' '), /reads.*profile\.md.*before.*project work/i);
  assert.match(profileRecall.pass.join(' '), /one-sentence status summary/i);
  assert.match(profileRecall.forbidden.join(' '), /prompt repeats.*preference/i);
});

test('behavior pass conditions stay positive while forbidden conditions own negative boundaries', () => {
  const catalog = JSON.parse(readFileSync(join(root, 'evals', 'scenarios.json'), 'utf8')) as {
    scenarios: Array<{ id: string; pass: string[]; forbidden: string[] }>;
  };
  for (const scenario of catalog.scenarios) {
    for (const condition of scenario.pass) {
      assert.doesNotMatch(
        condition,
        /^(?:No\b)|\b(?:does not|is not|are not)\b/i,
        `${scenario.id} duplicates a negative boundary in pass: ${condition}`,
      );
    }
  }
});

test('manual host evaluation evidence has a versioned machine-readable contract', () => {
  const schema = JSON.parse(readFileSync(join(root, 'evals', 'run.schema.json'), 'utf8'));
  const example = JSON.parse(readFileSync(join(root, 'evals', 'run.example.json'), 'utf8'));
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

  assert.equal(schema.$id, 'urn:harnessmith:eval-run:v4');
  assert.equal(validate(example), true, JSON.stringify(validate.errors));
  assert.equal(example.recordType, 'example-only');
  assert.equal(example.transcript.redacted, true);
  assert.match(example.evaluatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(example.transcript.artifactRef, /^local:/);
  assert.match(example.transcript.sha256, /^[a-f0-9]{64}$/);
  assert.match(example.subject.packageArtifactSha256, /^[a-f0-9]{64}$/);
  assert.match(example.subject.scenarioSha256, /^[a-f0-9]{64}$/);
  assert.match(example.subject.rulesSha256, /^[a-f0-9]{64}$/);
  assert.equal(example.subject.packageVersion, 'replace-with-current-package-version');
  assert.equal(example.subject.harnessVersion, 'replace-with-current-harness-version');
  assert.ok(example.host.product.length > 0);
  assert.ok(example.host.version.length > 0);
  assert.ok(example.host.model.length > 0);
  assert.ok(example.host.modelVersion.length > 0);
  assert.ok(Array.isArray(example.toolActions));
  assert.equal(schema.properties.toolActions.maxItems, 1024);
  assert.ok(Array.isArray(example.filesystemDiff.changedPaths));
  assert.ok(example.scenarioAssertions.length > 0);
  assert.equal(schema.properties.scenarioAssertions.maxItems, 64);
  assert.ok(example.forbiddenActionAssertions.length > 0);
  assert.equal(schema.properties.forbiddenActionAssertions.maxItems, 64);
  assert.equal(schema.properties.evidence.maxItems, 256);
  assert.ok(example.verdict.evidenceRefs.length > 0);
});
