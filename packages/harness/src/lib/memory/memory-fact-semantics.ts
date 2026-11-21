/**
 * Compatibility barrel: the pure memory fact semantics live in
 * `lib/contract/memory-fact-semantics.ts` so search can classify documents
 * without importing memory modules. Existing memory import paths keep working.
 */
export {
  assertFindingFactSemantics,
  classifyMemoryDocument,
  classifyMemoryFact,
  isMemoryFactClass,
  type MemoryFactClass,
  type MemoryFactClassification,
  validFactExpiry,
} from '../contract/memory-fact-semantics.js';
