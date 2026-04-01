import { defineConfig } from 'vitepress'

export const en = defineConfig({
  lang: 'en-US',
  description: 'Systematically study Claude Code CLI source code',
  themeConfig: {
    nav: [
      { text: 'Overview', link: '/en/' },
      { text: 'Principles', link: '/en/guide/architecture' },
      { text: 'Walkthroughs', link: '/en/walkthrough/conversation-flow' },
      { text: 'Module Index', link: '/en/modules' },
    ],
    sidebar: {
      '/en/guide/': [
        {
          text: 'Principles',
          items: [
            { text: '1. Architecture Overview', link: '/en/guide/architecture' },
            { text: '2. Startup & Initialization', link: '/en/guide/entry' },
            { text: '3. Tool System', link: '/en/guide/tool-system' },
            { text: '4. Command System', link: '/en/guide/command-system' },
            { text: '5. Skill Framework', link: '/en/guide/skill-system' },
            { text: '6. State Management', link: '/en/guide/state-management' },
            { text: '7. API Communication', link: '/en/guide/api-layer' },
            { text: '8. MCP Protocol', link: '/en/guide/mcp-protocol' },
            { text: '9. Agent Architecture', link: '/en/guide/agent-architecture' },
          ],
        },
      ],
      '/en/walkthrough/': [
        {
          text: 'Walkthroughs',
          items: [
            { text: '10. Conversation Flow', link: '/en/walkthrough/conversation-flow' },
            { text: '11. File Edit Pipeline', link: '/en/walkthrough/file-edit-pipeline' },
            { text: '12. Agent Dispatch', link: '/en/walkthrough/agent-dispatch' },
            { text: '13. Permission Model', link: '/en/walkthrough/permission-model' },
            { text: '14. Plugin System', link: '/en/walkthrough/plugin-extension' },
          ],
        },
      ],
    },
    editLink: {
      pattern: 'https://github.com/anthropics/claude-code/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
