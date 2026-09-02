import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { isExecutableVerificationPath } from '../evaluation/capability-evidence.js';

interface PromptRule {
  id?: unknown;
  owner?: unknown;
  principle?: unknown;
  rationale?: unknown;
  action?: unknown;
  fallback?: unknown;
  guarantee?: unknown;
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

function evidencePaths(value: unknown, key: 'implementation' | 'verification'): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return stringPaths((value as Record<string, unknown>)[key]);
}

function pathIssues(root: string, id: string, kind: string, paths: string[]): string[] {
  return paths.flatMap((path) => {
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
  return issues;
}

function guaranteeIssues(root: string, rule: PromptRule, index: number): string[] {
  const id = ruleId(rule, index);
  const implementation = evidencePaths(rule.evidence, 'implementation');
  const verification = evidencePaths(rule.evidence, 'verification');
  const boundary = stringPaths(rule.boundary);
  const issues = [
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
  return stringPaths(rule.confusingWith).flatMap((otherId) => {
    if (otherId === id) return [`prompt rule ${id} cannot be confused with itself`];
    const other = rulesById.get(otherId);
    if (!other) return [`prompt rule ${id} references unknown confusing rule: ${otherId}`];
    return stringPaths(other.confusingWith).includes(id)
      ? []
      : [`prompt confusing pair is not reciprocal: ${id} -> ${otherId}`];
  });
}

function promptRules(value: unknown): PromptRule[] {
  return Array.isArray(value)
    ? value.filter(
        (rule): rule is PromptRule =>
          Boolean(rule) && typeof rule === 'object' && !Array.isArray(rule),
      )
    : [];
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
  const rules = promptRules(document.rules);
  const owners = ownerIds(manifest);
  const issues = document.version === 1 ? [] : ['prompt rule contract version must be 1'];
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
