/**
 * Independent search source contract. Kept free of search-engine imports so
 * memory repair and index contracts can share the type without importing the
 * search implementation (which classifies memory documents).
 */
export type SearchTrust = 'guidance' | 'untrusted';

/** A bounded-discovery search root; traversal does not need trust classification. */
export interface SearchScanSource {
  root: string;
  label: string;
  excludeDirectories?: string[];
}

/** A search root with the trust classification used by match output and index scope. */
export interface SearchSource extends SearchScanSource {
  trust: SearchTrust;
}
