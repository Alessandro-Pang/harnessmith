export interface SlugOptions {
  /** Identifier returned when the value contains no slug-safe characters. */
  fallback: string;
  /**
   * Apply NFKC normalization before case folding. Defaults to true; task ids
   * disable it to preserve their historical id generation.
   */
  normalize?: boolean;
  /**
   * Fold case with the host-neutral `und` locale instead of `toLowerCase()`.
   * Defaults to false; task ids use it to stay independent of the host locale.
   */
  localeLowercase?: boolean;
}

/**
 * Shared bounded slug for derived document and task identifiers. Non-alphanumeric
 * runs collapse to a single dash, so trimming leading/trailing dash runs is
 * equivalent to trimming a single dash on each side.
 */
export function toSlug(value: string, options: SlugOptions): string {
  const normalized = options.normalize === false ? value : value.normalize('NFKC');
  const lowered = options.localeLowercase
    ? normalized.toLocaleLowerCase('und')
    : normalized.toLowerCase();
  return (
    lowered
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || options.fallback
  );
}
