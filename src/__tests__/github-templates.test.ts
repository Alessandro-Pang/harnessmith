import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { parse } from 'yaml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const issueRoot = join(root, '.github', 'ISSUE_TEMPLATE');

interface IssueForm {
  name?: unknown;
  description?: unknown;
  title?: unknown;
  body?: Array<{
    type?: unknown;
    id?: unknown;
    attributes?: Record<string, unknown>;
    validations?: { required?: unknown };
  }>;
}

function issueForm(name: string): IssueForm {
  return parse(readFileSync(join(issueRoot, name), 'utf8')) as IssueForm;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function assertBilingual(value: unknown, subject: string): void {
  const content = text(value);
  assert.match(content, /[A-Za-z]/, `${subject} must contain English`);
  assert.match(content, /[\u3400-\u9fff]/u, `${subject} must contain Chinese`);
}

test('GitHub issue forms are bilingual, parseable, and use stable required fields', () => {
  const expected = {
    'bug_report.yml': ['description', 'reproduction', 'expected', 'environment', 'logs', 'checks'],
    'docs_feedback.yml': ['page', 'kind', 'description'],
    'feature_request.yml': ['problem', 'proposal', 'scope', 'alternatives'],
    'question.yml': ['question', 'context', 'area'],
  };

  for (const [file, requiredIds] of Object.entries(expected)) {
    const form = issueForm(file);
    assertBilingual(form.name, `${file} name`);
    assertBilingual(form.description, `${file} description`);
    assert.equal(Array.isArray(form.body), true, `${file} body must be an array`);
    const ids = (form.body ?? []).map(({ id }) => id).filter(Boolean);
    for (const id of requiredIds) assert.ok(ids.includes(id), `${file} is missing ${id}`);
    for (const item of form.body ?? []) {
      if (item.type === 'textarea' || item.type === 'input' || item.type === 'dropdown') {
        assertBilingual(item.attributes?.label, `${file} ${String(item.id)} label`);
      }
    }
  }
});

test('issue forms keep required input friction within a small per-form budget', () => {
  const budgets = {
    'bug_report.yml': 4,
    'docs_feedback.yml': 3,
    'feature_request.yml': 2,
    'question.yml': 2,
  };
  for (const [file, budget] of Object.entries(budgets)) {
    const required = (issueForm(file).body ?? []).filter(
      ({ validations }) => validations?.required === true,
    );
    assert.ok(
      required.length <= budget,
      `${file} has ${required.length} required fields; max ${budget}`,
    );
  }
});

test('bug reports collect one compact environment block and forbid public security reports', () => {
  const form = issueForm('bug_report.yml');
  const byId = new Map((form.body ?? []).map((item) => [item.id, item]));

  for (const id of ['description', 'reproduction', 'expected', 'environment']) {
    assert.equal(byId.get(id)?.attributes?.label !== undefined, true, `missing bug field ${id}`);
  }
  for (const id of ['host', 'scope', 'version', 'node', 'os']) assert.equal(byId.has(id), false);
  const serialized = JSON.stringify(form);
  assert.match(serialized, /security advisor|安全公告/i);
  assert.match(serialized, /redact|脱敏/i);
  assert.match(serialized, /Codex/);
  assert.match(serialized, /Cursor/);
  assert.match(serialized, /Claude Code/);
  assert.match(serialized, /OpenCode/);
  assert.match(serialized, /Kimi Code CLI/);
  assert.match(serialized, /Node\.js/);
  const checks = byId.get('checks')?.attributes?.options as Array<{ required?: unknown }>;
  assert.equal(checks.filter(({ required }) => required === true).length, 1);
});

test('feature and question forms keep classification and contribution optional', () => {
  const feature = issueForm('feature_request.yml');
  const featureById = new Map((feature.body ?? []).map((item) => [item.id, item]));
  assert.equal(featureById.get('scope')?.validations?.required, undefined);
  assert.equal(featureById.has('contribution'), false);

  const question = issueForm('question.yml');
  const questionById = new Map((question.body ?? []).map((item) => [item.id, item]));
  assert.equal(questionById.get('area')?.validations?.required, undefined);
});

test('issue chooser routes vulnerabilities privately and disables blank issues', () => {
  const config = parse(readFileSync(join(issueRoot, 'config.yml'), 'utf8')) as {
    blank_issues_enabled?: unknown;
    contact_links?: Array<{ name?: unknown; url?: unknown; about?: unknown }>;
  };
  assert.equal(config.blank_issues_enabled, false);
  const security = config.contact_links?.find(({ url }) =>
    text(url).includes('/security/advisories/new'),
  );
  assert.ok(security, 'private security advisory contact link is missing');
  assertBilingual(security.name, 'security contact name');
  assertBilingual(security.about, 'security contact description');
});

test('pull request template is bilingual and requires scope, verification, and safety review', () => {
  const template = readFileSync(join(root, '.github', 'PULL_REQUEST_TEMPLATE.md'), 'utf8');
  for (const heading of [
    'Summary / 变更说明',
    'Related Issue / 关联 Issue',
    'Verification / 验证',
    'Checklist / 检查清单',
  ]) {
    assert.match(template, new RegExp(`^## ${heading}$`, 'm'));
  }
  assert.match(template, /pnpm run preflight/);
  assert.match(template, /security|安全/i);
  assert.match(template, /generated|生成/i);
  assert.match(template, /Host-neutral|宿主中立/i);
  assert.doesNotMatch(template, /^## Type of Change \/ 变更类型$/m);
  assert.ok((template.match(/^- \[ \]/gm) ?? []).length <= 4, 'PR checklist exceeds four items');
});
