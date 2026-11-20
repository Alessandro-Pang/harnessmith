import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { harnessTemplateRoot, installationRenderer } from '../installation/install-template.js';
import { installWithSkills } from '../installation/installation-workflow.js';
import { resolveUserData } from '../installation/user-data-paths.js';
import { atomicWrite } from '../shared/files.js';
import { assertSafePath } from '../shared/safe-path.js';
import type { Adapter, CliOptions } from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';
import {
  type AdoptImportCandidate,
  adoptHash,
  collectAdoptInventory,
  readAdoptRule,
} from './adopt-inventory.js';

function appendBlock(
  current: string,
  proposalId: string,
  candidates: AdoptImportCandidate[],
): string {
  const imported = candidates
    .map(
      ({ path, checksum, content }) =>
        `<!-- harnessmith-adopt:start ${proposalId.slice(-12)} -->\n` +
        `<!-- source: ${path}; sha256:${checksum} -->\n${content.trim()}\n` +
        '<!-- harnessmith-adopt:end -->',
    )
    .join('\n\n');
  return `${current.trimEnd()}${current.trim() ? '\n\n' : ''}${imported}\n`;
}

function exactDiff(path: string, before: string, after: string): string {
  const removed = before
    ? before
        .replace(/\n$/, '')
        .split('\n')
        .map((line) => `-${line}`)
    : [];
  const added = after
    .replace(/\n$/, '')
    .split('\n')
    .map((line) => `+${line}`);
  return [`--- ${path}`, `+++ ${path}`, ...removed, ...added].join('\n');
}

function personalTemplate(adapter: Adapter, env: NodeJS.ProcessEnv): string {
  const render = installationRenderer(adapter.userData, env);
  return render(
    readFileSync(join(harnessTemplateRoot, 'assets', 'templates', 'personal', 'AGENTS.md'), 'utf8'),
  );
}

function targetState(adapter: Adapter, env: NodeJS.ProcessEnv) {
  const userData = resolveUserData(env);
  const target = join(userData.rules, 'AGENTS.md');
  if (existsSync(target) && lstatSync(target).isSymbolicLink()) {
    return {
      target,
      before: '',
      expectedAfterInit: '',
      blocked: { path: target, reasonCode: 'SYMLINK_REJECTED' },
    };
  }
  assertSafePath(userData.rules, target);
  if (!existsSync(target)) {
    return { target, before: '', expectedAfterInit: personalTemplate(adapter, env), blocked: null };
  }
  const current = readAdoptRule(target);
  return current.ok
    ? { target, before: current.content, expectedAfterInit: current.content, blocked: null }
    : {
        target,
        before: '',
        expectedAfterInit: '',
        blocked: { path: target, reasonCode: current.reasonCode },
      };
}

export function createAdoptPlan(adapters: Adapter[], env: NodeJS.ProcessEnv) {
  const [adapter] = adapters;
  if (!adapter) throw new Error('Adopt requires at least one adapter');
  const collected = collectAdoptInventory(adapters);
  const target = targetState(adapter, env);
  const blocked = [...collected.blocked, ...(target.blocked ? [target.blocked] : [])];
  const seed = JSON.stringify({
    adapters: adapters.map(({ name }) => name),
    inventory: collected.inventory,
    target: target.target,
    targetBeforeChecksum: target.before ? adoptHash(target.before) : null,
  });
  const proposalHash = adoptHash(seed);
  const proposalId = `sha256:${proposalHash}`;
  const finalContent = collected.imports.length
    ? appendBlock(target.expectedAfterInit, proposalId, collected.imports)
    : target.expectedAfterInit;
  const stamp = `adopt-${proposalHash.slice(0, 12)}`;
  // Managed outputs whose recorded checksum still matches are skipped or replaced in
  // place by the installer (distribution never keeps sibling backups, identical files
  // are not rewritten), so the proposal must not promise sibling backups for them.
  const replacedInPlace = new Set(
    collected.inventory.filter(({ proposal }) => proposal === 'no-change').map(({ path }) => path),
  );
  const backups = Object.entries(collected.expectedOutputChecksums)
    .filter(([source, checksum]) => checksum !== null && !replacedInPlace.has(source))
    .map(([source]) => ({ source, path: `${source}.backup-${stamp}` }));
  const requiresWrite =
    blocked.length === 0 &&
    collected.inventory.some(({ proposal }) =>
      ['append-to-personal-overlay', 'backup-and-replace'].includes(proposal),
    );
  const report = {
    version: 1,
    command: 'adopt' as const,
    phase: 'proposal' as const,
    proposalId,
    requiresConfirmation: requiresWrite,
    requiresWrite,
    blocked,
    inventory: collected.inventory,
    target: { path: target.target, owner: 'user-owned-personal-overlay' as const },
    diff: requiresWrite ? exactDiff(target.target, target.before, finalContent) : null,
    backups,
    rollbackPaths: [
      ...Object.keys(collected.expectedOutputChecksums),
      target.target,
      ...backups.map(({ path }) => path),
    ],
  };
  return {
    report,
    internal: {
      expectedOutputChecksums: collected.expectedOutputChecksums,
      target: target.target,
      targetExpectedAfterInit: target.expectedAfterInit,
      finalContent,
      stamp,
    },
  };
}

export function applyAdoptPlan(
  adapters: Adapter[],
  env: NodeJS.ProcessEnv,
  options: Pick<CliOptions, 'proposal' | 'initGlobal'>,
) {
  const plan = createAdoptPlan(adapters, env);
  if (plan.report.blocked.length > 0) {
    throw new HarnessmithError('SAFETY_CONFLICT', 'Adopt proposal is blocked', 3);
  }
  if (options.proposal !== plan.report.proposalId) {
    throw new HarnessmithError(
      'STATE_CONFLICT',
      'Adopt proposal changed or was not confirmed; run adopt preview again',
      3,
    );
  }
  if (!plan.report.requiresWrite) {
    return { ...plan.report, phase: 'complete' as const, result: 'already-adopted' as const };
  }
  // Adopt shares the install workflow so the skills-managed skill is installed under the
  // same proposal-bound Host transaction semantics, including truthful partial failures.
  const installation = installWithSkills(adapters, {
    env,
    force: true,
    noInitGlobal: options.initGlobal === false,
    stamp: plan.internal.stamp,
    expectedOutputChecksums: plan.internal.expectedOutputChecksums,
    afterUserDataInitialize: () => {
      const current = readAdoptRule(plan.internal.target);
      if (!current.ok || current.content !== plan.internal.targetExpectedAfterInit) {
        throw new HarnessmithError(
          'STATE_CONFLICT',
          'Personal overlay changed after proposal; adopt stopped before import',
          3,
        );
      }
      atomicWrite(plan.internal.target, plan.internal.finalContent);
    },
  });
  return {
    ...plan.report,
    phase: 'complete' as const,
    result: 'adopted' as const,
    installation,
  };
}

export type AdoptReport = ReturnType<typeof createAdoptPlan>['report'];
