import { existsSync, lstatSync, rmSync } from 'node:fs';
import { readBoundedRegularFile } from './bounded-file.js';

const maximumCommandPayloadBytes = 256 * 1024;

type PayloadValueKind = 'boolean' | 'number' | 'string' | 'string[]';

export interface CommandPayloadSchema {
  fields: Readonly<Record<string, PayloadValueKind>>;
  required?: readonly string[];
  exactlyOne?: ReadonlyArray<readonly string[]>;
  aliases?: Readonly<Record<string, string>>;
}

interface CommandLineOptions {
  payloadFile?: unknown;
  consumePayloadFile?: unknown;
  json?: unknown;
  [key: string]: unknown;
}

type PayloadIdentity = ReturnType<typeof readBoundedRegularFile>['identity'];
const payloadConsumers = new WeakMap<object, () => void>();

function readPayloadFile(input: string): {
  path: string;
  value: unknown;
  identity: PayloadIdentity;
} {
  const { path, content, identity } = readBoundedRegularFile(input, {
    maxBytes: maximumCommandPayloadBytes,
    subject: 'Command payload file',
  });
  try {
    return { path, value: JSON.parse(content) as unknown, identity };
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
        : kind === 'number'
          ? typeof value === 'number'
          : Array.isArray(value) && value.every((item) => typeof item === 'string');
  if (!valid) throw new Error(`${command} payload option ${key} must be ${kind}`);
}

function domainOptions(
  command: string,
  cli: CommandLineOptions,
  schema: CommandPayloadSchema,
): { values: Record<string, unknown>; payload?: { path: string; identity: PayloadIdentity } } {
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
    if (!plainObject(parsed.value))
      throw new Error(`${command} payload must be a top-level plain object`);
    const unknown = Object.keys(parsed.value).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) throw new Error(`${command} payload has unknown key: ${unknown[0]}`);
    return { values: parsed.value, payload: { path: parsed.path, identity: parsed.identity } };
  }

  const resolved: Record<string, unknown> = {};
  for (const key of allowed) if (cli[key] !== undefined) resolved[key] = cli[key];
  for (const [source, target] of aliases) {
    if (cli[source] !== undefined) resolved[target] = cli[source];
  }
  return { values: resolved };
}

function consumePayload(path: string, expected: PayloadIdentity): void {
  const current = lstatSync(path);
  if (
    current.isSymbolicLink() ||
    !current.isFile() ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino ||
    current.size !== expected.size ||
    current.mtimeMs !== expected.mtimeMs ||
    current.ctimeMs !== expected.ctimeMs
  ) {
    throw new Error(`Command payload file changed before consumption: ${path}`);
  }
  rmSync(path);
  if (existsSync(path)) throw new Error(`Command payload file was not consumed: ${path}`);
}

export function resolveCommandPayload<T extends object>(
  command: string,
  cli: CommandLineOptions,
  schema: CommandPayloadSchema,
): T & { json?: boolean } {
  const { values: resolved, payload } = domainOptions(command, cli, schema);
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
  if (cli.consumePayloadFile !== undefined && typeof cli.consumePayloadFile !== 'boolean') {
    throw new Error(`${command} --consume-payload-file must be boolean`);
  }
  if (cli.consumePayloadFile && !payload) {
    throw new Error(`${command} --consume-payload-file requires --payload-file`);
  }
  const options = { ...resolved, ...(cli.json === undefined ? {} : { json: cli.json }) } as T & {
    json?: boolean;
  };
  if (cli.consumePayloadFile && payload) {
    payloadConsumers.set(options, () => consumePayload(payload.path, payload.identity));
  }
  return options;
}

export function executeCommandPayload<T extends object, TResult>(
  options: T,
  operation: (resolved: T) => TResult,
): TResult {
  const result = operation(options);
  const consume = payloadConsumers.get(options);
  if (consume) {
    consume();
    payloadConsumers.delete(options);
  }
  return result;
}
