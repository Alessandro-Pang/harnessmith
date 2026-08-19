# Personal Repository Relationship Map

这里保存跨仓关系的名称级入口和正式来源指针，不复制容易从代码、manifest 或部署配置恢复的细节。

仅在关系稳定、跨任务重复使用且重新发现成本较高时补充：

```text
<producer repository>
  -> <contract or artifact>
  -> <consumer repository>
  source: <docs/path-or-verification-command>
```

临时调查、用户输入和交接状态放项目 `.agent-docs/`；正式关系仍以项目文档、ADR、代码、测试、
schema 或部署契约为准。
