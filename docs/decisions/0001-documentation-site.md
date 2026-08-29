---
title: ADR-0001 文档站点
description: 选择 VitePress、GitHub Pages 与本地搜索
owner: maintainers
---

# ADR-0001：VitePress 文档站点

- 状态：Accepted
- 日期：2026-08-29

## 背景

README 同时承担上手、CLI 参考、架构、边界、Memory、发布和评测说明，导致首次使用路径不清晰，也缺少可导航、
可检索和可验证的深度文档。项目需要与 npm 包独立运行的静态站点，但不希望引入服务端搜索或长期运维基础设施。

## 候选方案

1. 保留纯 Markdown：依赖最少，但缺少统一导航、构建期链接验证与站内搜索。
2. VitePress + GitHub Pages：复用 Markdown，生成纯静态站点和本地搜索索引，部署面较小。
3. 自建应用与搜索服务：能力上限更高，但引入运行时、数据同步和服务运维。

## 决定

采用固定版本 VitePress，源码保留在 `docs/`，部署基础路径为 `/harnessmith/`。Pull Request 必须完成生产构建；
只有 `main` push 才由 GitHub Pages workflow 部署。使用默认主题的本地搜索，在构建阶段基于页面正文生成 MiniSearch
索引，不依赖外部服务。

中文作为深度文档 canonical 版本；英文维护 README、站点入口和快速开始。README 只承担定位、最短路径、安全摘要
与稳定站点导航。

## 后果

- 优点：本地可运行、无服务端依赖、PR 可验证、内部链接在构建时检查、搜索随内容版本发布。
- 限制：索引随文档规模增长并下载到浏览器，不提供向量语义召回；大规模或混合搜索属于后续独立决策。
- 运维：缓存和 `dist` 不提交；依赖版本、workflow action 与 Pages 配置需要定期维护。
