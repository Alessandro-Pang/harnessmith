# Personal Harness Overlay

本目录保存跨 Agent、由用户维护的个人规则和事实导航，不属于 Harnessmith 的受管理分发产物。

- `AGENTS.md`：个人补充规则；保持精简，只放高损失、不可推断约束和按需路由。
- `projects/repository-map.yaml`：跨仓目录与直接关系的 canonical 语义数据。
- `projects/repository-map.md`：由 YAML 确定性生成的人类可读视图，不直接编辑。
- `.agent-docs/` 不属于本目录；它只保存非权威记忆。

Harnessmith 初始化时只创建缺失文件，升级、restore 和 uninstall 都不会覆盖或删除本目录。
