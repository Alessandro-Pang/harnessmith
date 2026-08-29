import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'Harnessmith',
  description: '跨宿主分发和安全管理个人 Agent Harness',
  base: '/harnessmith/',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: { hostname: 'https://alexpang.cn' },
  locales: {
    root: { label: '简体中文', lang: 'zh-CN' },
    en: { label: 'English', lang: 'en', link: '/en/' },
  },
  head: [['meta', { name: 'theme-color', content: '#176b5b' }]],
  themeConfig: {
    nav: [
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '宿主支持', link: '/guide/hosts' },
      { text: '架构', link: '/architecture' },
      { text: 'CLI', link: '/reference/cli' },
      { text: 'English', link: '/en/' },
    ],
    sidebar: {
      '/en/': [
        {
          text: 'English',
          items: [
            { text: 'Overview', link: '/en/' },
            { text: 'Getting started', link: '/en/getting-started' },
          ],
        },
      ],
      '/': [
        {
          text: '开始使用',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '宿主支持', link: '/guide/hosts' },
            { text: '生命周期', link: '/guide/lifecycle' },
          ],
        },
        {
          text: '理解 Harnessmith',
          items: [
            { text: '架构', link: '/architecture' },
            { text: '设计原则', link: '/concepts/design-principles' },
            { text: '责任与安全边界', link: '/concepts/boundaries' },
            { text: 'Memory 与 Task', link: '/concepts/memory-and-tasks' },
          ],
        },
        {
          text: '参考与维护',
          items: [
            { text: 'CLI 参考', link: '/reference/cli' },
            { text: '版本与迁移', link: '/versions/migrations' },
            { text: '贡献指南', link: '/contributing' },
            { text: '内容策略', link: '/content-strategy' },
            { text: 'ADR', link: '/decisions/' },
            { text: '参考资料', link: '/references' },
          ],
        },
      ],
    },
    search: { provider: 'local' },
    socialLinks: [{ icon: 'github', link: 'https://github.com/Alessandro-Pang/harnessmith' }],
    editLink: {
      pattern: 'https://github.com/Alessandro-Pang/harnessmith/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Harnesssmith contributors',
    },
  },
});
