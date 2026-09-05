---
title: Search and Benchmark Reference
type: harness-reference
status: active
updated: 2026-09-04
owner: harness-cli-architecture
---

# Search and Benchmark Reference

仅在调试搜索、调整预算或复核 backend 选型时加载。普通任务只需要 `tool-routing.md` 的选择原则和
`search` 返回的 provenance；不要把 benchmark 数字当成当前项目事实或 Host 行为证明。

## 模式与降级

`--mode auto|scan|fulltext` 中，`auto` 只有在 index format、backend、analyzer、ICU、policy、scope 和源文件 identity 全部有效时使用全文索引；
否则回退有界扫描。`fulltext` 在同一条件不满足时 fail closed，`scan` 保留原路径。只有显式
`--refresh-index` 写入可重建缓存。

结果保留 `source`、`trust`、`path`、`line`、`retrieval`、`scanTruncated`、预算、统计和跳过原因。扫描被截断时，
未命中只能是 `inconclusive`，不能解释为不存在。

## 默认预算

默认扫描最多深入 8 层、访问 5000 个目录条目、进入 1000 个目录、访问 1000 个普通文件、读取单文件 1 MiB、
总计 8 MiB、运行 2 秒。显式刷新最多 50000 个文件、256 MiB 和 60 秒，但仍可由同一预算参数收窄。

## 当前选型证据

Phase 1 backend 选择 MiniSearch；固定 10k 语料的质量和资源数字只属于独立 benchmark 提交，不能外推到 50k。
MiniSearch 与 Orama 在固定 1 GiB old-space 下的 50k 真实正文扩容均有 OOM 负面证据；规模结论必须绑定语料、配置、
机器和候选 digest。

索引使用 Markdown heading/YAML 边界切块、版本化 tokenizer、BM25、字段 boost、受限 Latin fuzzy 和末词 prefix。
trust 只进入 provenance，不参与评分；同分按 source、路径、行号和 chunk id 稳定排序。倒排索引不保存正文，缓存
不是 Memory、规则或项目事实源。

## 验收

调整搜索实现时至少验证：命中质量、中文/英文混合、索引失效回退、预算截断、路径 containment、缓存原子性、锁、
权限和 secret hygiene。性能数字必须说明 measured/not-measured；没有真实候选或 Host 证据时写 `inconclusive`。
