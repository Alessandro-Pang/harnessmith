# Harness behavior evaluations

Unit tests prove file and CLI behavior. These scenarios evaluate whether a real coding agent follows the
installed Harness. They are intentionally host-independent and should be run against every supported Adapter
before a stable release.

`scenarios.json` contains prompts, setup requirements, observable pass conditions, and `automatedChecks` that
bind each scenario to local regression tests for its deterministic contracts. Run the complete agent scenario
in disposable repositories with no credentials or production access. Capture the host version, Harness
version, transcript, tool actions, and pass/fail evidence. Do not turn subjective prose quality into a pass
condition.

The repository verifies every referenced local regression test, but does not automatically launch third-party
agents. Automated host runners should remain optional because they can incur cost, require authentication, and
mutate external state.

Record each manual or authorized host run with `run.schema.json`. `run.example.json` is only a schema fixture;
it is not proof that any host evaluation ran. A real record must name the actual adapter and host version,
reference a redacted local or CI artifact transcript, record observable evidence, and use `inconclusive` when
authentication, cost, permissions, or platform limits prevent a valid result. Do not commit raw credentials,
private repository content, or unredacted transcripts.
