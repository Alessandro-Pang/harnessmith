/**
 * Compatibility barrel: the pure frontmatter parser lives in
 * `lib/contract/frontmatter.ts` so pure contract semantics (memory fact
 * classification) can parse documents without importing documentation I/O
 * modules. Existing documentation import paths keep working.
 */
export {
  type FrontmatterResult,
  parseFrontmatter,
  parseFrontmatterDocument,
  updateFrontmatter,
} from '../contract/frontmatter.js';
