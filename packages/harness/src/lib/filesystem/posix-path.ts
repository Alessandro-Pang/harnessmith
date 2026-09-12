/** Portable relative-path spelling for reports, indexes, and stored references. */
export function toPosixPath(path: string): string {
  return path.replaceAll('\\', '/');
}
