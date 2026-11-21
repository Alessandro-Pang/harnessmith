/**
 * Neutral core-index label contract. Escapes literal `memory:` prefixes so label
 * text cannot pose as an index reference. Shared by the memory core writer and
 * task progress rendering without coupling their modules.
 */
export function escapeCoreLabel(value: string): string {
  return value.replaceAll('memory:', 'memory&#58;');
}
