import type { CommandPayloadSchema } from './command-payload.js';

// Commander renders help for flags; the JSON payload behind `--payload-file` is our own
// contract, so its help is rendered here from the same schema that validates it.

function kindLabel(schema: CommandPayloadSchema, key: string): string {
  const allowed = schema.values?.[key];
  if (allowed) return allowed.map((value) => JSON.stringify(value)).join(' | ');
  return schema.fields[key] ?? 'unknown';
}

function exampleValue(schema: CommandPayloadSchema, key: string): unknown {
  const allowed = schema.values?.[key];
  if (allowed) return allowed[0];
  switch (schema.fields[key]) {
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'string[]':
      return ['text'];
    default:
      return 'text';
  }
}

function wrapExample(example: string, width: number): string {
  const lines: string[] = [];
  let current = '';
  for (const part of example.split(/(?<=,)/)) {
    if (current && current.length + part.length > width) {
      lines.push(current);
      current = '';
    }
    current += part;
  }
  if (current) lines.push(current);
  return lines.map((line, index) => `${index === 0 ? '  ' : '   '}${line}`).join('\n');
}

export function commandPayloadHelp(schema: CommandPayloadSchema, note?: string): string {
  const keys = Object.keys(schema.fields);
  const required = new Set(schema.required ?? []);
  const width = Math.max(...keys.map((key) => key.length)) + 1;
  const rows = keys.map((key) => {
    const marker = required.has(key) ? '*' : ' ';
    return `  ${`${key}${marker}`.padEnd(width + 1)} ${kindLabel(schema, key)}`;
  });
  const example = Object.fromEntries(
    keys.filter((key) => required.has(key)).map((key) => [key, exampleValue(schema, key)]),
  );
  return [
    '',
    `Payload keys (JSON object via --payload-file; * = required)${note ? `: ${note}` : ''}`,
    ...rows,
    '',
    'Example:',
    wrapExample(JSON.stringify(example), 88),
    '',
  ].join('\n');
}
