import { readBoundedRegularFile } from './bounded-file.js';

const maximumCommandPayloadBytes = 256 * 1024;

type PayloadValueKind = 'boolean' | 'string' | 'string[]';

export interface CommandPayloadSchema {
  fields: Readonly<Record<string, PayloadValueKind>>;
  required?: readonly string[];
  exactlyOne?: ReadonlyArray<readonly string[]>;
  aliases?: Readonly<Record<string, string>>;
}

interface CommandLineOptions {
  payloadFile?: unknown;
  json?: unknown;
  [key: string]: unknown;
}

function readPayloadFile(input: string): unknown {
  const { path, content } = readBoundedRegularFile(input, {
    maxBytes: maximumCommandPayloadBytes,
    subject: 'Command payload file',
  });
  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Command payload file contains invalid JSON: ${path}`, { cause: error });
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateValue(command: string, key: string, value: unknown, kind: PayloadValueKind): void {
  const valid =
    kind === 'string'
      ? typeof value === 'string'
      : kind === 'boolean'
        ? typeof value === 'boolean'
        : Array.isArray(value) && value.every((item) => typeof item === 'string');
  if (!valid) throw new Error(`${command} payload option ${key} must be ${kind}`);
}

function domainOptions(
  command: string,
  cli: CommandLineOptions,
  schema: CommandPayloadSchema,
): Record<string, unknown> {
  const allowed = Object.keys(schema.fields);
  const aliases = Object.entries(schema.aliases || {});
  const inline = [...allowed, ...aliases.map(([key]) => key)].filter(
    (key) => cli[key] !== undefined,
  );
  if (cli.payloadFile !== undefined) {
    if (typeof cli.payloadFile !== 'string' || !cli.payloadFile.trim()) {
      throw new Error(`${command} --payload-file requires a non-empty path`);
    }
    if (inline.length > 0) {
      throw new Error(`${command} --payload-file cannot be combined with inline domain options`);
    }
    const parsed = readPayloadFile(cli.payloadFile);
    if (!plainObject(parsed))
      throw new Error(`${command} payload must be a top-level plain object`);
    const unknown = Object.keys(parsed).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) throw new Error(`${command} payload has unknown key: ${unknown[0]}`);
    return parsed;
  }

  const resolved: Record<string, unknown> = {};
  for (const key of allowed) if (cli[key] !== undefined) resolved[key] = cli[key];
  for (const [source, target] of aliases) {
    if (cli[source] !== undefined) resolved[target] = cli[source];
  }
  return resolved;
}

export function resolveCommandPayload<T extends object>(
  command: string,
  cli: CommandLineOptions,
  schema: CommandPayloadSchema,
): T & { json?: boolean } {
  const resolved = domainOptions(command, cli, schema);
  for (const [key, value] of Object.entries(resolved)) {
    validateValue(command, key, value, schema.fields[key]);
  }
  for (const key of schema.required || []) {
    if (resolved[key] === undefined) throw new Error(`${command} requires payload option ${key}`);
  }
  for (const group of schema.exactlyOne || []) {
    if (group.filter((key) => resolved[key] !== undefined).length !== 1) {
      throw new Error(`${command} requires exactly one of ${group.join(', ')}`);
    }
  }
  if (cli.json !== undefined && typeof cli.json !== 'boolean') {
    throw new Error(`${command} --json must be boolean`);
  }
  return { ...resolved, ...(cli.json === undefined ? {} : { json: cli.json }) } as T & {
    json?: boolean;
  };
}
