import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { validateDocs } from '../lib/documentation/docs-validation.js';
import { listFiles } from '../lib/filesystem/files.js';
import { projectSnapshot } from '../lib/project/project.js';
import { addCheck as check } from '../lib/filesystem/validation-report.js';
import type { Io, Runtime, ValidationReport, ValidationSummary } from '../types.js';
import { errorMessage } from '../types.js';

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
function validateStructure(runtime: Runtime, report: ValidationReport): void {
  const entry = join(runtime.installedHarness, 'bin', 'harness.mjs');
  if (!existsSync(entry)) {
    check(report, 'cli-entry', 'failed', 'Missing CLI entry', entry);
    return;
  }
  const entryLines = readFileSync(entry, 'utf8').split(/\r?\n/).length;
  check(
    report,
    'cli-entry-size',
    entryLines <= 30 ? 'passed' : 'failed',
    `CLI entry has ${entryLines} lines`,
    entry,
  );
  check(
    report,
    'cli-entry-mode',
    process.platform === 'win32' || (statSync(entry).mode & 0o111) !== 0 ? 'passed' : 'failed',
    process.platform === 'win32'
      ? 'CLI entry is runnable through Node.js'
      : 'CLI entry is executable',
    entry,
  );
}

function validateInstructions(runtime: Runtime, report: ValidationReport): void {
  for (const path of runtime.instructionFiles) {
    if (!existsSync(path)) {
      check(report, 'instructions', 'failed', 'Missing instruction file', path);
      continue;
    }
    const content = readFileSync(path, 'utf8');
    const lines = content.split(/\r?\n/).length;
    check(
      report,
      'instructions-size',
      lines <= 130 ? 'passed' : 'warning',
      `Instruction file has ${lines} lines`,
      path,
    );
    if (/\{\{[A-Z0-9_]+\}\}/.test(content)) {
      check(
        report,
        'template-token',
        'failed',
        'Unresolved template token in instruction file',
        path,
      );
    }
  }
}

function validateVersion(runtime: Runtime, report: ValidationReport): void {
  const path = join(runtime.installedHarness, 'manifest.json');
  if (!existsSync(path)) {
    check(report, 'harness-manifest', 'failed', 'Missing harness manifest', path);
    return;
  }
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    const compatible =
      typeof manifest.harnessVersion === 'string' &&
      manifest.schemaVersion === 3 &&
      manifest.memorySchemaVersion === 1 &&
      manifest.node === '>=24.12.0';
    check(
      report,
      'harness-manifest',
      compatible ? 'passed' : 'failed',
      `Harness ${manifest.harnessVersion || 'unknown'}, schema ${manifest.schemaVersion || 'unknown'}, memory schema ${manifest.memorySchemaVersion || 'unknown'}, Node ${manifest.node || 'unknown'}`,
      path,
    );
  } catch (error) {
    check(report, 'harness-manifest', 'failed', `Invalid JSON: ${errorMessage(error)}`, path);
  }
}

function validateProject(runtime: Runtime, input: string, report: ValidationReport): void {
  const project = projectSnapshot(input);
  check(
    report,
    'project-git',
    project.isGitRepository ? 'passed' : 'warning',
    project.isGitRepository ? 'Git repository detected' : 'Not a Git repository',
    project.root,
  );
  if (!project.memory.exists) return;
  check(
    report,
    'project-memory',
    project.memory.initialized ? 'passed' : 'failed',
    project.memory.initialized ? 'Project memory initialized' : 'Project memory is partial',
    project.memory.root,
  );
  for (const name of ['.gitignore', '.ignore']) {
    const path = join(project.memory.root, name);
    const ignored = existsSync(path) && readFileSync(path, 'utf8').split(/\r?\n/).includes('*');
    check(
      report,
      'project-memory-ignore',
      ignored ? 'passed' : 'failed',
      `${name} memory rule`,
      path,
    );
  }
  const working = join(project.memory.root, 'working');
  if (!existsSync(working)) return;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const taskSchema = JSON.parse(
    readFileSync(join(runtime.installedHarness, 'schemas', 'task.schema.json'), 'utf8'),
  );
  const validateTask = ajv.compile(taskSchema);
  for (const path of listFiles(working).filter((file) => file.endsWith(`${sep}task.json`))) {
    try {
      const task = JSON.parse(readFileSync(path, 'utf8')) as { id?: string };
      const valid = validateTask(task);
      const details = valid ? '' : `: ${ajv.errorsText(validateTask.errors, { separator: '; ' })}`;
      check(
        report,
        'task-schema',
        valid ? 'passed' : 'failed',
        valid ? `Task schema valid: ${task.id}` : `Invalid task schema${details}`,
        path,
      );
    } catch (error) {
      check(report, 'task-schema', 'failed', `Invalid task JSON: ${errorMessage(error)}`, path);
    }
  }
}

function summary(report: ValidationReport): ValidationSummary {
  return report.checks.reduce(
    (counts, item) => {
      counts[item.status] += 1;
      return counts;
    },
    { passed: 0, warning: 0, failed: 0 },
  );
}

export function validate(
  runtime: Runtime,
  { project, json = false }: { project?: string; json?: boolean } = {},
  io: Io = console,
): number {
  const report: ValidationReport = {
    version: 1,
    checks: [],
    summary: { passed: 0, warning: 0, failed: 0 },
    valid: false,
  };
  validateVersion(runtime, report);
  validateInstructions(runtime, report);
  validateDocs(runtime, report);
  validateStructure(runtime, report);
  if (project) validateProject(runtime, project, report);
  report.summary = summary(report);
  report.valid = report.summary.failed === 0;

  if (json) io.log(JSON.stringify(report, null, 2));
  else {
    for (const item of report.checks) {
      if (item.status === 'passed') continue;
      io.log(
        `${item.status.toUpperCase()} ${item.id}: ${item.message}${item.path ? ` (${item.path})` : ''}`,
      );
    }
    io.log(
      `Validation: ${report.summary.passed} passed, ${report.summary.warning} warning, ${report.summary.failed} failed`,
    );
  }
  return report.valid ? 0 : 1;
}
