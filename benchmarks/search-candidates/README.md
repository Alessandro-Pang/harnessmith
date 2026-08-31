# Search candidate benchmark evidence

This isolated workspace records the reproducible Phase 1 backend comparison for issue #12. It is not part of the
production package, root dependency graph, regular CI, or published bundle.

## Reproduce

Use Node.js 24.12 or newer from this directory:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm run benchmark -- --sizes 1000,10000,50000 --iterations 30 --output results/search-candidates.json
```

The command prints and writes machine-readable JSON. Each candidate/size runs in a fresh child process with a 1024 MiB
old-space limit so one backend cannot contaminate the other's retained-heap measurement. A budget failure is retained in
the report instead of silently reducing the requested 1k/10k/50k matrix.

## Corpus and queries

The corpus builder reads the sorted, public `template/agent-harness/docs` Markdown/YAML files. Markdown is split by
heading and then at 16,000 characters, matching the production chunk boundary. The real chunks are cycled
deterministically to the requested size with stable replica ids; their text is not replaced by a repeated synthetic
sentence. The report records the source corpus digest, generated corpus digest, construction description, and query-set
digest.

`queries.json` fixes exact technical identifiers, an English title query, a bounded Latin typo, and Chinese natural
sentences against known source documents. Quality is reported as document-level Top-5/Top-10 recall after deduplicating
replicated chunks by their real source path.

## Candidate configuration

- MiniSearch 7.2.0 and Orama 3.1.18 are fixed by the isolated lockfile.
- Both index `aliases`, `title`, `headings`, `path`, and `body` with boosts 10/8/5/2/1.
- Both use the same Harness analyzer: NFKC normalization, Chinese word segmentation plus bigrams, and preserved technical
  identifiers.
- MiniSearch uses the production query policy: no fuzzy/prefix expansion for technical identifiers, last-term prefix for
  other queries, and edit distance 1 only for Latin/alphanumeric terms of length at least five.
- Orama uses exact matching for technical identifiers, prefix matching for other queries, and tolerance 1 only for the
  fixed fuzzy query category. The difference is explicit because Orama does not expose MiniSearch's per-term fuzzy and
  last-term-prefix callbacks.

Metrics include build, one-document update, cold restore, per-category P50/P95, Top-5/Top-10 recall, retained/stage-peak
heap, serialized index bytes, and an esbuild-minified candidate bundle size.
