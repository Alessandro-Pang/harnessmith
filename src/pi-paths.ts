import { join, win32 } from 'node:path';

function normalizeWindowsShellPath(input: string, platform: NodeJS.Platform): string {
  if (platform !== 'win32') return input;

  const convertDrivePath = (drive: string, suffix = '') =>
    `${drive.toUpperCase()}:\\${suffix.replace(/\//g, '\\')}`;
  const mntMatch = input.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (mntMatch) return convertDrivePath(mntMatch[1], mntMatch[2]);
  const cygwinMatch = input.match(/^\/cygdrive\/([a-zA-Z])(?:\/(.*))?$/);
  if (cygwinMatch) return convertDrivePath(cygwinMatch[1], cygwinMatch[2]);
  const msysMatch = input.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
  if (msysMatch) return convertDrivePath(msysMatch[1], msysMatch[2]);
  return input;
}

/** Normalize documented Pi path forms before SafePath canonicalization. */
export function normalizePiAgentDir(
  input: string,
  userHome: string,
  platform: NodeJS.Platform = process.platform,
): string {
  const normalized = normalizeWindowsShellPath(input, platform);
  if (normalized === '~') return userHome;
  if (normalized.startsWith('~/') || normalized.startsWith('~\\')) {
    const joinHome = platform === 'win32' ? win32.join : join;
    return joinHome(userHome, normalized.slice(2));
  }
  return normalized;
}
