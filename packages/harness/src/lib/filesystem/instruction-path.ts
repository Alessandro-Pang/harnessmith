import { lstatSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isPathInside } from './safe-path.js';

export type InstructionPathCheck = { valid: true } | { valid: false; reason: string };

/**
 * Validate an instruction path without following any symlink component.
 *
 * Instruction files are executable policy, so their identity must be bound to
 * the managed home before consumers read them. Missing regular paths are left
 * to the caller to report as missing; a symlink (including a dangling one) is
 * always invalid because it can be retargeted after identity verification.
 */
export function validateInstructionPath(
  harnessHome: string,
  instructionPath: string,
): InstructionPathCheck {
  if (!isAbsolute(harnessHome) || !isAbsolute(instructionPath)) {
    return { valid: false, reason: 'Instruction path must be absolute' };
  }

  const authorizedRoot = resolve(harnessHome);
  const requested = resolve(instructionPath);
  if (!isPathInside(authorizedRoot, requested)) {
    return { valid: false, reason: 'Instruction path escapes the managed home' };
  }

  let current = authorizedRoot;
  for (const component of relative(authorizedRoot, requested).split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      if (lstatSync(current).isSymbolicLink()) {
        return { valid: false, reason: `Instruction path contains a symbolic link: ${current}` };
      }
    } catch (error) {
      const { code } = error as NodeJS.ErrnoException;
      if (code === 'ENOENT' || code === 'ENOTDIR') return { valid: true };
      return {
        valid: false,
        reason: `Instruction path cannot be inspected: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  return { valid: true };
}
