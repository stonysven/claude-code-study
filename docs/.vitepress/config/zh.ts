import { defineConfig } from 'vitepress'

export const zh = defineConfig({
  lang: 'zh-CN',
  description: '系统性学习 Claude Code CLI 源码',
  themeConfig: {
    nav: [
      { text: '概览', link: '/zh/' },
      { text: '原理篇', link: '/zh/guide/architecture' },
      { text: '走读篇', link: '/zh/walkthrough/conversation-flow' },
      { text: '模块索引', link: '/zh/modules' },
    ],
    sidebar: {
      '/zh/guide/': [
        {
          text: '原理篇',
          items: [
            { text: '1. 整体架构概览', link: '/zh/guide/architecture' },
            { text: '2. 启动与初始化流程', link: '/zh/guide/entry' },
            { text: '3. Tool 系统', link: '/zh/guide/tool-system' },
            { text: '4. Command 系统', link: '/zh/guide/command-system' },
            { text: '5. Skill 框架与加载机制', link: '/zh/guide/skill-system' },
            { text: '6. 状态管理与 Store', link: '/zh/guide/state-management' },
            { text: '7. API 通信层', link: '/zh/guide/api-layer' },
            { text: '8. MCP 协议集成', link: '/zh/guide/mcp-protocol' },
            { text: '9. Agent 多代理架构', link: '/zh/guide/agent-architecture' },
          ],
        },
      ],
      '/zh/walkthrough/': [
        {
          text: '走读篇',
          items: [
            { text: '10. 完整对话处理链路', link: '/zh/walkthrough/conversation-flow' },
            { text: '11. 文件编辑管线', link: '/zh/walkthrough/file-edit-pipeline' },
            { text: '12. Agent 调度与执行', link: '/zh/walkthrough/agent-dispatch' },
            { text: '13. 权限校验模型', link: '/zh/walkthrough/permission-model' },
            { text: '14. 插件与扩展机制', link: '/zh/walkthrough/plugin-extension' },
          ],
        },
      ],
    },
    editLink: {
      pattern: 'https://github.com/anthropics/claude-code/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
  },
})
