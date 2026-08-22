# Personal Repository Relationship Map

这里保存跨仓关系的名称级入口和正式来源指针，不复制容易从代码、manifest 或部署配置恢复的细节。

仅在关系稳定、已验证、跨任务可复用且重新发现成本较高时补充。先按 producer、contract、consumer
和 source 去重，只保留名称级关系与正式来源：

```text
<producer repository>
  -> <contract or artifact>
  -> <consumer repository>
  source: <authoritative path or repeatable verification command>
```

不要写入当前分支、HEAD、dirty 状态、临时迁移阶段、一次性调查结论、用户输入、报告正文或未经核验
的线上状态。临时材料放项目 `.agent-docs/`；正式关系仍以项目文档、ADR、代码、测试、schema 或
部署契约为准。跨仓任务交付时按维护规范报告 `proposed`、`updated`、`unchanged` 或 `blocked`。
