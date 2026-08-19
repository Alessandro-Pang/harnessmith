# Personal Harness Overlay

本目录保存跨 Agent、由用户维护的个人规则和事实导航，不属于 Harnesssmith 的受管理分发产物。

- `AGENTS.md`：个人补充规则；保持精简，只放高损失、不可推断约束和按需路由。
- `projects/repository-map.md`：跨仓关系入口；稳定事实仍应指向项目正式文档、代码或契约。
- `.agent-docs/` 不属于本目录；它只保存非权威记忆。

Harnesssmith 初始化时只创建缺失文件，升级、restore 和 uninstall 都不会覆盖或删除本目录。
