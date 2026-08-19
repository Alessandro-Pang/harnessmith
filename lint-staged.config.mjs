export default {
  '*.{js,mjs,cjs,ts,mts,cts,json,jsonc}': 'biome check --no-errors-on-unmatched',
  '*.md': 'markdownlint-cli2 --no-globs',
};
