import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { CommandPayloadSchema } from '../lib/filesystem/command-payload.js';
import { commandPayloadHelp } from '../lib/filesystem/command-payload-help.js';

const schema = {
  fields: { mode: 'string', title: 'string', count: 'number', tags: 'string[]', dry: 'boolean' },
  values: { mode: ['fast', 'safe'] },
  required: ['mode', 'title', 'dry'],
} as const satisfies CommandPayloadSchema;

test('payload help is rendered from the validating schema, not maintained by hand', () => {
  const help = commandPayloadHelp(schema, 'a note');

  assert.match(help, /Payload keys .*\* = required\): a note/);
  assert.match(help, /^ {2}mode\* +"fast" \| "safe"$/m);
  assert.match(help, /^ {2}title\* +string$/m);
  assert.match(help, /^ {2}count +number$/m);
  assert.match(help, /^ {2}tags +string\[\]$/m);
  assert.match(help, /^ {2}dry\* +boolean$/m);

  // The example is valid against the schema: required keys only, first enum value, typed defaults.
  const example = JSON.parse(help.slice(help.indexOf('{'), help.lastIndexOf('}') + 1));
  assert.deepEqual(example, { mode: 'fast', title: 'text', dry: false });
});

test('long examples wrap at commas so help stays readable in narrow terminals', () => {
  const wide = {
    fields: Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`veryLongPayloadKeyNumber${index}`, 'boolean']),
    ),
    required: Array.from({ length: 12 }, (_, index) => `veryLongPayloadKeyNumber${index}`),
  } as const satisfies CommandPayloadSchema;
  const lines = commandPayloadHelp(wide).split('\n');
  const exampleLines = lines.slice(lines.indexOf('Example:') + 1).filter(Boolean);
  assert.ok(exampleLines.length > 1);
  for (const line of exampleLines) assert.ok(line.length <= 92, line);
  assert.equal(Object.keys(JSON.parse(exampleLines.join('').trim())).length, 12);
});
