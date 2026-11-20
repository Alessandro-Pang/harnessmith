import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { validateDocs } from '../lib/documentation/docs-validation.js';
import { digestBudgetDefaults, listFiles } from '../lib/filesystem/files.js';
import { addCheck as check } from '../lib/filesystem/validation-report.js';
import { projectSnapshot } from '../lib/project/project.js';
import type { Io, Runtime, ValidationReport, ValidationSummary } from '../types.js';
import { errorMessage } from '../types.js';

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => Ajv2020;
function validateStructure(runtime: Runtime, report: ValidationReport): void {
  // The bundled Runtime is imported by the global CLI, not exec'd directly: it must be a
  // readable regular file within the integrity byte budget, not a small executable shim.
  const entry = join(runtime.distributionRoot, 'dist', 'harness.mjs');
  if (!existsSync(entry)) {
    check(report, 'cli-entry', 'failed', 'Missing bundled CLI entry', entry);
    return;
  }
  const stats = statSync(entry);
  check(
    report,
    'cli-entry',
    stats.isFile() ? 'passed' : 'failed',
    stats.isFile() ? 'Bundled CLI entry present' : 'Bundled CLI entry is not a regular file',
    entry,
  );
  check(
    report,
    'cli-entry-size',
    stats.size > 0 && stats.size <= digestBudgetDefaults.maxFileBytes ? 'passed' : 'failed',
    `Bundled CLI entry is ${stats.size} bytes`,
    entry,
  );
  let readable = true;
  try {
    accessSync(entry, constants.R_OK);
  } catch {
    readable = false;
  }
  check(
    report,
    'cli-entry-readable',
    readable ? 'passed' : 'failed',
    readable ? 'Bundled CLI entry is readable by Node.js' : 'Bundled CLI entry is not readable',
    entry,
  );
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
      manifest.node === '>=22.20.0';
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
    readFileSync(join(runtime.installedHarness, 'assets', 'schemas', 'task.schema.json'), 'utf8'),
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
