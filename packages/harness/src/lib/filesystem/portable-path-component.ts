/**
 * Compatibility barrel: the pure portable identity primitives live in
 * `lib/contract/portable-path-component.ts` so contract modules never import
 * filesystem modules. Existing filesystem import paths keep working.
 */
export {
  isPortableIdentityComponent,
  isPortablePathComponent,
  maximumPortableIdentityCharacters,
} from '../contract/portable-path-component.js';
