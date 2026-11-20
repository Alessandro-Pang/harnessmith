import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import type { ReasoningScenario } from '../eval-codex-reasoning-types.js';

const maximumReasoningResultBytes = 64 * 1024;

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasMatchingJsonType(value: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(value);
  if (isJsonObject(expected)) return isJsonObject(value);
  return typeof value === typeof expected;
}

function validateArtifact(artifact: JsonObject, scenario: ReasoningScenario): void {
  for (const key of scenario.requiredArtifacts) {
    if (!Object.hasOwn(artifact, key)) continue;
    const value = artifact[key];
    if (
      typeof value !== 'string' &&
      typeof value !== 'boolean' &&
      !Array.isArray(value) &&
      !isJsonObject(value)
    ) {
      throw new Error(`reasoning result field has an invalid schema type: ${key}`);
    }
  }
  for (const [key, expected] of Object.entries(scenario.fixture.output)) {
    if (Object.hasOwn(artifact, key) && !hasMatchingJsonType(artifact[key], expected)) {
      throw new Error(`reasoning result fixture field has an invalid schema type: ${key}`);
    }
  }
}

/** Read only a bounded regular file, rejecting symlinks and malformed artifact schemas. */
export function readReasoningResultArtifact(path: string, scenario: ReasoningScenario): JsonObject {
  let descriptor: number | undefined;
  let text: string;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(descriptor).isFile()) throw new Error('reasoning result must be a regular file');
    const buffer = Buffer.alloc(maximumReasoningResultBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maximumReasoningResultBytes) {
      throw new Error(`reasoning result exceeds ${maximumReasoningResultBytes} bytes`);
    }
    text = buffer.subarray(0, offset).toString('utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    if (error instanceof Error && error.message.startsWith('reasoning result')) throw error;
    throw new Error('reasoning result must be a readable regular file without symlinks');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }

  let artifact: unknown;
  try {
    artifact = JSON.parse(text);
  } catch {
    throw new Error('reasoning result must contain valid JSON');
  }
  if (!isJsonObject(artifact)) throw new Error('reasoning result must be a JSON object');
  validateArtifact(artifact, scenario);
  return artifact;
}
