/**
 * Compatibility barrel: the task-ledger memory contract is a neutral pure rule
 * shared by memory validation and task progress rendering. It lives in
 * `lib/contract/task-ledger.ts` so memory does not import the task area.
 */
export { canonicalTaskLedgerId } from '../contract/task-ledger.js';
