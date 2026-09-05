---
title: References
description: The public sources behind Harnessmith's design, implementation, and verification
owner: maintainers
audience: maintainers
status: active
updated: 2026-09-05
lang: en
---

# References

This page lists design background and external terminology sources. They exist to explain concepts and do not
override the executable facts in the repository; if a source conflicts with the code, schema, tests, manifest,
or the [capability evidence matrix](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml),
the current repository wins.

## How the sources are used

| Category | Use | What it cannot prove |
| --- | --- | --- |
| Current implementation | Determining commands, fields, default values, and denial conditions | Cannot automatically explain how users should use them |
| Tests and CI | Determining repeatable regressions and gates | Cannot prove a real Host always behaves the same |
| Design/architecture sources | Understanding background, terminology, and trade-offs | Cannot replace the current implementation contract |
| Historical sources | Tracing how a problem evolved | Cannot be used as the current support list |

When adding a citation, mark whether it is an implementation dependency, an enforced protocol, a historical
input, or a design inspiration, and provide a direct link and access date. Record inaccessible external links
as `inconclusive`; do not treat titles or search snippets as facts.

## Public sources

### Current project contracts

- [Capability evidence matrix](https://github.com/Alessandro-Pang/harnessmith/blob/main/apps/docs/site/capability-evidence.yaml):
  capability owners, states, and executable evidence paths.
- [Harness CLI architecture](https://github.com/Alessandro-Pang/harnessmith/blob/main/template/agent-harness/docs/core/harness-cli-architecture.md):
  Runtime commands, data boundaries, and module owners.
- [Manifest](https://github.com/Alessandro-Pang/harnessmith/blob/main/template/agent-harness/manifest.json):
  Runtime, schema, and distribution file contracts.
- [Security Policy](https://github.com/Alessandro-Pang/harnessmith/blob/main/SECURITY.md):
  vulnerability reporting and support scope.

### Agent rules and progressive context

- [AGENTS.md](https://agents.md/): the rules entry point across coding agents; Harnessmith additionally provides
  docs routing and a safe install lifecycle.
- [Codex AGENTS.md discovery rules](https://developers.openai.com/codex/guides/agents-md/): Codex's global and
  project instruction discovery contract.
- [Agent Skills specification](https://agentskills.io/specification): skill directories, metadata, and
  progressive disclosure specification.
- [OpenAI Harness Engineering](https://openai.com/index/harness-engineering/): making repository knowledge
  readable and enforcing architecture boundaries with mechanical constraints.

### Long-running tasks, state, and handoff

- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):
  working across contexts, initialization, and handoff artifacts.
- [Anthropic: Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps):
  task decomposition, structured handoff, and evaluators.
- [OpenAI Symphony](https://openai.com/index/open-source-codex-orchestration-symphony/): a reference for a
  persistent control plane with an issue tracker and task runner.

### Tool protocols and security

- [Model Context Protocol specification](https://modelcontextprotocol.io/specification/): the tool and resource
  interoperability protocol; Harnessmith does not implement MCP.
- [MCP security best practices](https://modelcontextprotocol.io/specification/draft/basic/security_best_practices):
  token passthrough, sessions, permissions, and local service risks.
- [OWASP Top 10 for Agentic Applications 2026](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/):
  threat vocabulary such as goal hijack, tool misuse, and memory poisoning.
- [NIST AI RMF 1.0](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10):
  a risk framework reference for continuous governance, measurement, and management.
- [SLSA specification](https://slsa.dev/spec/v1.1/): a supply-chain integrity reference for candidate artifacts,
  CI, and attestation.

### Evaluation, observability, and research

- [Test harness (Wikipedia)](https://en.wikipedia.org/wiki/Test_harness): general terminology background for
  test harnesses.
- [EleutherAI lm-evaluation-harness](https://github.com/EleutherAI/lm-evaluation-harness): a public
  implementation of evaluation tasks, model adapters, and repeatable evidence.
- [OpenAI Evals](https://github.com/openai/evals): executable evaluations and regression ideas.
- [SWE-bench](https://www.swebench.com/): a representative benchmark of real-repository tasks and
  verifier-driven evaluation.
- [OpenTelemetry](https://opentelemetry.io/docs/specs/otel/): the open observability specification for traces,
  metrics, and logs.
- [Agent Harness Engineering: A Survey (2026)](https://picrew.github.io/LLM-Harness/): a research map of related
  open-source projects and taxonomy; not a specification.
- [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/): the positional effect of information in long
  contexts; research background for progressive disclosure.

### Documentation site and delivery

- [VitePress deployment guide](https://vitepress.dev/guide/deploy): static builds and deployment methods.
- [VitePress local search](https://vitepress.dev/reference/default-theme-search): the build-time search index
  and its boundaries.
- [GitHub Pages documentation](https://docs.github.com/pages): site publishing and the permission model.

## Verification order

When answering a question about specific behavior, look things up in this order:

1. The current command's `--help` and source-code registration;
2. Schemas, Adapter definitions, and configuration;
3. Relevant unit tests, preflight, and capability evidence;
4. This site's guides and reference pages;
5. External sources and historical records.

This order lets external sources provide background instead of accidentally becoming unverified product
promises.
