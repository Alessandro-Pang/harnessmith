import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const projectMemoryFixtures = [
  'empty',
  'seeded',
  'closable-input',
  'experience-ready',
  'active-handoff',
  'supersede-pair',
  'archivable-closed',
  'maintenance-trigger',
  'repairable-missing-readme',
  'legacy-migrate',
  'curation-candidates',
] as const;

export interface MemorySeedContext {
  repo: string;
  tempDir: string;
}

interface MemorySeedStep {
  argv: string[];
  payload?: unknown;
  capture?: 'reference';
  removeFromProjectMemory?: string;
}

export type MemorySeedRunner = (argv: string[]) => { stdout: string };

const profilePayload = {
  key: 'communication.review-format',
  conclusion: 'Start reviews with the conclusion.',
  evidence: 'explicit',
  confidence: 'high',
};

const seededInput = {
  title: 'Existing project acceptance constraint',
  content: 'Run focused tests before reporting a result.',
  source: 'chat',
  mode: 'summary',
  purpose: 'constraint',
  retention: 'durable',
  scope: ['.'],
};

function captureInput(title: string, content: string, extra: Record<string, unknown> = {}) {
  return {
    argv: ['memory', 'capture-input', '{repo}', '--payload-file', '{payload}', '--json'],
    payload: {
      title,
      content,
      source: 'chat',
      mode: 'summary',
      purpose: 'constraint',
      retention: 'durable',
      ...extra,
    },
    capture: 'reference' as const,
  };
}

function memoryFixtureSteps(scope: 'global' | 'project', name: string): MemorySeedStep[] {
  if (scope === 'global') {
    if (name === 'empty') return [];
    if (name === 'seeded') {
      return [
        {
          argv: ['memory', 'reconcile-profile', '--payload-file', '{payload}', '--json'],
          payload: profilePayload,
        },
      ];
    }
    throw new Error(`Unknown global memory fixture: ${name}`);
  }
  switch (name) {
    case 'empty':
    case 'experience-ready':
      return [];
    case 'seeded':
    case 'closable-input':
    case 'maintenance-trigger':
    case 'legacy-migrate':
      return [
        captureInput(seededInput.title, seededInput.content, {
          retention: 'durable',
          scope: ['.'],
        }),
      ];
    case 'active-handoff':
      return [
        {
          argv: ['memory', 'handoff', '{repo}', '--payload-file', '{payload}', '--json'],
          payload: {
            session: 'eval-handoff',
            title: 'Eval recovery snapshot',
            objective: 'Keep the next action recoverable.',
            completed: 'Seeded the active handoff fixture.',
            next: 'Close this handoff after verification.',
            reason: 'phase',
          },
        },
      ];
    case 'supersede-pair':
      return [
        captureInput('Obsolete eval fixture', 'This older constraint is no longer current.'),
        captureInput('Replacement eval fixture', 'Use this replacement constraint instead.'),
      ];
    case 'archivable-closed':
      return [
        captureInput('Closed eval fixture', 'This input is ready to archive.'),
        {
          argv: [
            'memory',
            'close-input',
            '{repo}',
            '{reference}',
            '--reason',
            'consumed',
            '--json',
          ],
        },
      ];
    case 'repairable-missing-readme':
      return [{ argv: [], removeFromProjectMemory: 'README.md' }];
    case 'curation-candidates':
      return [
        {
          argv: [
            'task',
            'init',
            '--project',
            '{repo}',
            '--id',
            'eval-curate',
            '--objective',
            'Prepare curation candidates',
            '--accept',
            'Independent gate',
            '--json',
          ],
        },
        captureInput('Workstream eval input', 'Close this input when the workstream completes.', {
          purpose: 'constraint',
          retention: 'workstream',
          workstream: 'eval-curate',
        }),
      ];
    default:
      throw new Error(`Unknown project memory fixture: ${name}`);
  }
}

function interpolate(value: string, slots: Record<string, string>): string {
  return value.replaceAll(/\{([a-z]+)\}/gu, (_match, key: string) => {
    const next = slots[key];
    if (!next) throw new Error(`Seed step is missing {${key}}`);
    return next;
  });
}

function capturedReference(stdout: string): string {
  const parsed = JSON.parse(stdout) as { reference?: unknown };
  if (typeof parsed.reference !== 'string' || !parsed.reference.startsWith('memory:')) {
    throw new Error(`Seed step did not return a memory reference: ${stdout.slice(0, 200)}`);
  }
  return parsed.reference.slice('memory:'.length);
}

export function applyMemoryFixtureSeeds(input: {
  globalMemory: string;
  projectMemory: string;
  context: MemorySeedContext;
  run: MemorySeedRunner;
}): void {
  const slots: Record<string, string> = { repo: input.context.repo };
  let payloadIndex = 0;
  for (const [scope, name] of [
    ['global', input.globalMemory],
    ['project', input.projectMemory],
  ] as const) {
    for (const step of memoryFixtureSteps(scope, name)) {
      if (step.removeFromProjectMemory) {
        rmSync(join(input.context.repo, '.agent-docs', step.removeFromProjectMemory), {
          force: true,
        });
        continue;
      }
      if (step.argv.length === 0) continue;
      if (step.payload !== undefined) {
        mkdirSync(input.context.tempDir, { recursive: true });
        const payload = join(input.context.tempDir, `seed-${payloadIndex}.json`);
        payloadIndex += 1;
        writeFileSync(payload, `${JSON.stringify(step.payload)}\n`);
        slots.payload = payload;
      }
      const argv = step.argv.map((part) => interpolate(part, slots));
      const result = input.run(argv);
      if (step.capture === 'reference') slots.reference = capturedReference(result.stdout);
    }
  }
}
