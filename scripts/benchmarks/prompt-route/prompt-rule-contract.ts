import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { isExecutableVerificationPath } from '../../evaluation/capability-evidence.js';

interface PromptRule {
  id?: unknown;
  owner?: unknown;
  principle?: unknown;
  rationale?: unknown;
  action?: unknown;
  fallback?: unknown;
  guarantee?: unknown;
  enforcedBy?: unknown;
  evidence?: unknown;
  boundary?: unknown;
  confusingWith?: unknown;
}

interface PromptRuleContract {
  version?: unknown;
  rules?: unknown;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringPaths(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(nonEmptyString) : [];
}

/**
 * Malformed list entries must surface as issues: dropping them silently would let a rule claim
 * evidence it never provides and still satisfy the guarantee checks below.
 */
function stringListIssues(id: string, field: string, value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return [`prompt rule ${id} ${field} must be a list of strings`];
  return value.flatMap((entry, index) =>
    nonEmptyString(entry)
      ? []
      : [`prompt rule ${id} ${field}[${index}] must be a non-empty string`],
  );
}

function evidencePaths(value: unknown, key: 'implementation' | 'verification'): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return stringPaths((value as Record<string, unknown>)[key]);
}

function evidenceShapeIssues(id: string, value: unknown): string[] {
  if (value === undefined) return [];
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return [`prompt rule ${id} evidence must be an object`];
  const evidence = value as Record<string, unknown>;
  return [
    ...stringListIssues(id, 'evidence.implementation', evidence.implementation),
    ...stringListIssues(id, 'evidence.verification', evidence.verification),
  ];
}

function pathIssues(root: string, id: string, kind: string, paths: string[]): string[] {
  return paths.flatMap((path) => {
    // Evidence is distributed with the repository and must stay portable.
    // Reject absolute and traversal spellings before resolve(), otherwise an
    // absolute path inside the checkout or a normalized ../ path could look
    // valid while referring to a host-specific location.
    if (
      path.startsWith('/') ||
      path.startsWith('\\\\') ||
      /^[A-Za-z]:/u.test(path) ||
      path.split(/[\\/]/u).includes('..')
    ) {
      return [`prompt rule ${id} references unsafe ${kind} evidence path: ${path}`];
    }
    const target = resolve(root, path);
    return target.startsWith(`${resolve(root)}${sep}`) && existsSync(target)
      ? []
      : [`prompt rule ${id} references missing ${kind} evidence: ${path}`];
  });
}

function ruleId(rule: PromptRule, index: number): string {
  return nonEmptyString(rule.id) ? rule.id : `#${index + 1}`;
}

function baseRuleIssues(rule: PromptRule, index: number, owners: Set<string>): string[] {
  const id = ruleId(rule, index);
  const issues: string[] = [];
  if (!nonEmptyString(rule.id)) issues.push(`prompt rule ${id} has no id`);
  if (!nonEmptyString(rule.owner) || !owners.has(rule.owner))
    issues.push(`prompt rule ${id} references unknown owner: ${String(rule.owner ?? '')}`);
  for (const field of ['principle', 'rationale', 'action', 'fallback'] as const) {
    if (!nonEmptyString(rule[field])) issues.push(`prompt rule ${id} has no ${field}`);
  }
  if (
    !nonEmptyString(rule.guarantee) ||
    !['enforced', 'guided', 'host-dependent'].includes(rule.guarantee)
  )
    issues.push(`prompt rule ${id} has invalid guarantee`);
  if (!nonEmptyString(rule.enforcedBy)) issues.push(`prompt rule ${id} has no enforcement subject`);
  else if (!['agent', 'host', 'runtime', 'verifier'].includes(rule.enforcedBy))
    issues.push(`prompt rule ${id} has invalid enforcement subject`);
  else if (rule.guarantee === 'guided' && rule.enforcedBy !== 'agent')
    issues.push(`guided prompt rule ${id} must be enforced by agent`);
  else if (rule.guarantee === 'host-dependent' && rule.enforcedBy !== 'host')
    issues.push(`host-dependent prompt rule ${id} must be enforced by host`);
  else if (rule.guarantee === 'enforced' && rule.enforcedBy === 'agent')
    issues.push(`enforced prompt rule ${id} cannot be enforced by agent`);
  else if (
    rule.guarantee === 'enforced' &&
    rule.enforcedBy !== 'runtime' &&
    rule.enforcedBy !== 'verifier'
  )
    issues.push(`enforced prompt rule ${id} must be enforced by runtime or verifier`);
  return issues;
}

function guaranteeIssues(root: string, rule: PromptRule, index: number): string[] {
  const id = ruleId(rule, index);
  const implementation = evidencePaths(rule.evidence, 'implementation');
  const verification = evidencePaths(rule.evidence, 'verification');
  const boundary = stringPaths(rule.boundary);
  const issues = [
    ...evidenceShapeIssues(id, rule.evidence),
    ...stringListIssues(id, 'boundary', rule.boundary),
    ...pathIssues(root, id, 'implementation', implementation),
    ...pathIssues(root, id, 'verification', verification),
    ...pathIssues(root, id, 'boundary', boundary),
  ];
  if (rule.guarantee === 'enforced') {
    if (implementation.length === 0)
      issues.unshift(`enforced prompt rule ${id} has no implementation evidence`);
    if (verification.length === 0)
      issues.unshift(`enforced prompt rule ${id} has no verification evidence`);
    for (const path of verification) {
      if (!isExecutableVerificationPath(path))
        issues.push(`enforced prompt rule ${id} verification evidence is not executable: ${path}`);
    }
  }
  if ((rule.guarantee === 'guided' || rule.guarantee === 'host-dependent') && boundary.length === 0)
    issues.unshift(`${rule.guarantee} prompt rule ${id} has no boundary evidence`);
  return issues;
}

function confusingPairIssues(
  rule: PromptRule,
  index: number,
  rulesById: Map<string, PromptRule>,
): string[] {
  const id = ruleId(rule, index);
  const shape = stringListIssues(id, 'confusingWith', rule.confusingWith);
  if (shape.length > 0) return shape;
  return stringPaths(rule.confusingWith).flatMap((otherId) => {
    if (otherId === id) return [`prompt rule ${id} cannot be confused with itself`];
    const other = rulesById.get(otherId);
    if (!other) return [`prompt rule ${id} references unknown confusing rule: ${otherId}`];
    return stringPaths(other.confusingWith).includes(id)
      ? []
      : [`prompt confusing pair is not reciprocal: ${id} -> ${otherId}`];
  });
}

function isPromptRule(rule: unknown): rule is PromptRule {
  return Boolean(rule) && typeof rule === 'object' && !Array.isArray(rule);
}

function promptRules(value: unknown): { rules: PromptRule[]; issues: string[] } {
  if (!Array.isArray(value))
    return { rules: [], issues: ['prompt rule contract has no rule list'] };
  const issues = value.flatMap((rule, index) =>
    isPromptRule(rule) ? [] : [`prompt rule #${index + 1} must be an object`],
  );
  return { rules: value.filter(isPromptRule), issues };
}

function ownerIds(manifest: unknown): Set<string> {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return new Set();
  const entries = (manifest as { entries?: unknown }).entries;
  return entries && typeof entries === 'object' && !Array.isArray(entries)
    ? new Set(Object.keys(entries))
    : new Set();
}

export function promptRuleContractIssues(
  root: string,
  manifest: unknown,
  contract: unknown,
): string[] {
  const document =
    contract && typeof contract === 'object' && !Array.isArray(contract)
      ? (contract as PromptRuleContract)
      : {};
  const { rules, issues: ruleShapeIssues } = promptRules(document.rules);
  const owners = ownerIds(manifest);
  const issues = document.version === 1 ? [] : ['prompt rule contract version must be 1'];
  issues.push(...ruleShapeIssues);
  const rulesById = new Map<string, PromptRule>();
  for (const rule of rules) {
    if (!nonEmptyString(rule.id)) continue;
    if (rulesById.has(rule.id)) issues.push(`prompt rule id is duplicated: ${rule.id}`);
    else rulesById.set(rule.id, rule);
  }
  for (const [index, rule] of rules.entries()) {
    issues.push(...baseRuleIssues(rule, index, owners));
    issues.push(...guaranteeIssues(root, rule, index));
    issues.push(...confusingPairIssues(rule, index, rulesById));
  }
  return issues;
}
