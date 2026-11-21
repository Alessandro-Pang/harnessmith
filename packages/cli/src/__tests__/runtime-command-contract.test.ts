import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { onTestFinished, test } from 'vitest';
import {
  capturedIo,
  harnessRuntime,
} from '../../../../packages/harness/src/__tests__/helpers/harness.js';
import { createHarnessProgram } from '../../../../packages/harness/src/cli.js';
import { createProgram } from '../app/program.js';
import { formatRuntimeCommandsHelp, runtimeCommandNames } from '../runtime/runtime-entry.js';

function registeredHarnessCommands(): string[] {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-runtime-contract-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const { program } = createHarnessProgram(harnessRuntime(root), capturedIo(), 'harnessmith');
  return program.commands.map((command) => command.name());
}

test('runtime dispatch list matches the Harness registered top-level commands exactly', () => {
  const registered = registeredHarnessCommands().sort();
  const dispatched = [...runtimeCommandNames].sort();

  // A command added to the Harness but missing from the dispatch list (or vice versa)
  // must fail here, so the installer can never silently drop a Runtime command.
  assert.deepEqual(dispatched, registered);
  assert.equal(dispatched.length, 15);
  assert.equal(new Set(dispatched).size, dispatched.length, 'no duplicate dispatch entries');
});

test('installer help is derived from the dispatch list and names every Runtime command', () => {
  const help = formatRuntimeCommandsHelp();
  assert.match(help, /Runtime commands \(executed by the bundled Runtime\):/);
  for (const name of runtimeCommandNames) {
    assert.ok(help.includes(name), `derived help is missing ${name}`);
  }

  const output = new PassThrough();
  const program = createProgram(() => {}, { output, error: new PassThrough() });
  program.outputHelp();
  const programHelp = String(output.read() ?? '');
  assert.ok(
    programHelp.includes('Runtime commands (executed by the bundled Runtime):'),
    'program help must embed the derived runtime block',
  );
  for (const name of runtimeCommandNames) {
    assert.ok(programHelp.includes(name), `program help is missing ${name}`);
  }
});
