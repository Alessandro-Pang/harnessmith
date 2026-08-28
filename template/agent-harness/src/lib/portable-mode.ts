export function modeMatches(
  actual: number,
  expected: number,
  platform = process.platform,
): boolean {
  return platform === 'win32' || (actual & 0o777) === expected;
}
