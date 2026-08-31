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
sentences against known source documents. Latency is measured against every requested scale. Ranking quality is measured
against one copy of every real Harness documentation chunk and reported as document-level Top-5/Top-10 recall. Keeping
the quality corpus separate prevents identical scale replicas from crowding each other out of Top-N; both corpus digests
are recorded in the result.

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

## Recorded Node 24 run

`results/search-candidates.json` records the complete 30-iteration run against method commit
`1ec7a2773c4aad7528b47a3cbedfada8b88d645e` on Node 24.19.0, macOS arm64, Apple M4, 16 GiB RAM. Selected 10k
metrics are summarized below; the JSON remains the source of truth for every query, P50/P95 value, digest, and bounded
failure trace. Machine-specific home paths in those traces are redacted.

| Candidate | Build | Update | Restore | Retained / stage peak heap | Index / bundle | Exact P95 | English P95 | Fuzzy P95 | Chinese P95 | Exact R@5/10 | Chinese R@5/10 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| MiniSearch | 10.11 s | 0.54 ms | 319 ms | 95.6 / 342.5 MiB | 21.5 MiB / 17.2 KiB | 0.73 ms | 3.45 ms | 2.33 ms | 10.76 ms | 100% / 100% | 100% / 100% |
| Orama | 25.61 s | 5.32 ms | 816 ms | 279.5 / 480 MiB | 112 MiB / 66.7 KiB | 48.41 ms | 5.91 ms | 17.65 ms | 36.44 ms | 100% / 100% | 83% / 83% |

Both 50k workers terminated with `SIGABRT` under the fixed 1024 MiB old-space budget; their final V8 traces are retained
in the JSON. This is negative evidence, not a missing row: neither candidate is established as safe for a 50k corpus of
these real, relatively large Harness chunks under that memory limit.

MiniSearch remains the Phase 1 choice because at the 10k persistent-index scale it preserves the fixed query quality
while using substantially less retained heap, serialized storage, and bundle space, and it builds and restores faster.
The 50k result does not justify silently lifting the persistence budget; larger corpora must remain bounded/fail-fast or
fall back to scanning until a separately evidenced backend or partitioning design exists.
