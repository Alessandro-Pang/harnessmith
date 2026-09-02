import { readBoundedRegularFile } from '../filesystem/bounded-file.js';
import type { CurationApplySelection } from './memory-curation-contract.js';

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function readCurationSelectionFile(path: string): CurationApplySelection[] {
  const { content } = readBoundedRegularFile(path, {
    maxBytes: 256 * 1024,
    subject: 'Curation selection file',
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error('Curation selection file contains invalid JSON', { cause: error });
  }
  if (!plainObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.selections)) {
    throw new Error('Curation selection file must contain version 1 and a selections array');
  }
  const unknownRoot = Object.keys(parsed).filter((key) => !['version', 'selections'].includes(key));
  if (unknownRoot.length > 0) {
    throw new Error(`Curation selection file has unknown key: ${unknownRoot[0]}`);
  }
  return parsed.selections.map((value, index) => {
    if (!plainObject(value) || typeof value.proposalId !== 'string') {
      throw new Error(`Curation selection ${index} must contain a proposalId`);
    }
    const unknown = Object.keys(value).filter(
      (key) => !['proposalId', 'replacement', 'promotion'].includes(key),
    );
    if (unknown.length > 0) {
      throw new Error(`Curation selection ${index} has unknown key: ${unknown[0]}`);
    }
    if (value.replacement !== undefined && typeof value.replacement !== 'string') {
      throw new Error(`Curation selection ${index} replacement must be string`);
    }
    if (value.promotion !== undefined && !plainObject(value.promotion)) {
      throw new Error(`Curation selection ${index} promotion must be an object`);
    }
    return value as unknown as CurationApplySelection;
  });
}
