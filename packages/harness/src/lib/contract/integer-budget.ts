type IntegerBudgetError = 'positive-integer' | 'minimum' | 'invalid';

export interface IntegerBudgetSpec {
  /** Error subject, for example `Search limit` or `digest maxEntries`. */
  subject: string;
  /** Inclusive lower bound; defaults to 1. */
  minimum?: number;
  /** Error phrasing; defaults to `positive-integer`. */
  error?: IntegerBudgetError;
  /**
   * When true the fallback participates in validation (`value ?? fallback`);
   * when false an undefined value returns the fallback untouched, preserving
   * the historical difference between the budget parsers.
   */
  validateFallback?: boolean;
}

/**
 * Shared integer budget resolution. Callers keep their own subject, minimum and
 * error phrasing; the primitive only centralizes the integer/lower-bound check.
 */
export function resolveIntegerBudget(
  value: number | undefined,
  fallback: number | undefined,
  spec: IntegerBudgetSpec,
): number {
  const minimum = spec.minimum ?? 1;
  if (value === undefined && !spec.validateFallback) return fallback as number;
  const resolved: unknown = spec.validateFallback ? (value ?? fallback) : value;
  if (typeof resolved !== 'number' || !Number.isInteger(resolved) || resolved < minimum) {
    const error = spec.error ?? 'positive-integer';
    throw new Error(
      error === 'minimum'
        ? `${spec.subject} must be an integer greater than or equal to ${minimum}`
        : error === 'invalid'
          ? `Invalid ${spec.subject}: ${resolved}`
          : `${spec.subject} must be a positive integer`,
    );
  }
  return resolved;
}
