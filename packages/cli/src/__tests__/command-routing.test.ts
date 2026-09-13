import assert from 'node:assert/strict';
import { test } from 'vitest';
import { commandRoute } from '../application/command-routing.js';

test('classifies command execution by whether adapter resolution is required', () => {
  assert.equal(commandRoute('capabilities'), 'direct');
  assert.equal(commandRoute('export'), 'direct');
  assert.equal(commandRoute('import'), 'direct');
  assert.equal(commandRoute('install'), 'adapter');
  assert.equal(commandRoute('status'), 'adapter');
  assert.equal(commandRoute('uninstall'), 'adapter');
});
