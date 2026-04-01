import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

const DATA_DIR = join(import.meta.dir, '..', 'data')
const DOCS_DIR = join(import.meta.dir, '..', 'docs', 'zh')

interface ModuleIndex {
  modules: {
    name: string
    path: string
    description: string
    fileCount: number
    lineCount: number
    exports: { name: string; kind: string; line: number; file: string }[]
  }[]
}

const chapters = [
  {
    file: 'guide/architecture.md',
    title: '1. 整体架构概览',
    modules: null as string[] | null,
    prompt: `Write a comprehensive architecture overview of Claude Code CLI. Cover:
- High-level architecture diagram (describe for SVG creation)
- Core modules and their responsibilities
- Data flow: user input → command parsing → tool execution → response
- Key design patterns used
- Entry point: main.tsx
Format in Markdown with Chinese text.`,
  },
  {
    file: 'guide/entry.md',
    title: '2. 启动与初始化流程',
    modules: ['cli', 'bootstrap'],
    prompt: `Write a detailed walkthrough of Claude Code CLI startup and initialization. Cover:
- CLI argument parsing (cli/ directory)
- Bootstrap sequence (bootstrap/ directory)
- Profile checkpoint and MDM raw read
- Keychain prefetch
- Application initialization
Include code excerpts and call chains. Format in Chinese Markdown.`,
  },
  {
    file: 'guide/tool-system.md',
    title: '3. Tool 系统',
    modules: ['tools'],
    prompt: `Write a comprehensive guide to Claude Code's Tool system. Cover:
- Tool interface definition
- Tool registration and dispatch
- File operation tools: FileReadTool, FileWriteTool, FileEditTool
- Shell execution: BashTool
- Code search: GlobTool, GrepTool
- Agent sub-tool: AgentTool
- Tool permission model
Include code excerpts, module dependencies, and call chains. Format in Chinese Markdown.`,
  },
  {
    file: 'guide/command-system.md',
    title: '4. Command 系统',
    modules: ['commands'],
    prompt: `Write a guide to Claude Code's Command system (slash commands). Cover:
- Command registration and routing
- Command categories: git, debug, code review, project management
- Key commands: /commit, /review, /pr, /debug
- Command hooks and middleware
Include code excerpts. Format in Chinese Markdown.`,
  },
  {
    file: 'guide/skill-system.md',
    title: '5. Skill 框架与加载机制',
    modules: ['skills'],
    prompt: `Write a guide to Claude Code's Skill framework. Cover:
- Skill loading mechanism
- Bundled skills
- MCP skill builders
- Skill execution lifecycle
Include code excerpts. Format in Chinese Markdown.`,
  },
  {
    file: 'guide/state-management.md',
    title: '6. 状态管理与 Store',
    modules: ['state'],
    prompt: `Write a guide to Claude Code's state management. Cover:
- AppState architecture
- State selectors
- State change handlers
- How UI components consume state via hooks
Include code excerpts. Format in Chinese Markdown.`,
  },
  {
    file: 'guide/api-layer.md',
    title: '7. API 通信层',
    modules: ['services', 'remote'],
    prompt: `Write a guide to Claude Code's API communication layer. Cover:
- Claude API integration
- Remote session management
- Cost tracking
- Rate limiting and retry logic
Include code excerpts. Format in Chinese Markdown.`,
  },
  {
    file: 'guide/mcp-protocol.md',
    title: '8. MCP 协议集成',
    modules: ['services'],
    prompt: `Write a guide to Claude Code's MCP (Model Context Protocol) integration. Cover:
- MCP server connection management
- Tool/resource exposure via MCP
- MCP authentication flow
- MCP plugin system
Include code excerpts. Format in Chinese Markdown.`,
  },
  {
    file: 'guide/agent-architecture.md',
    title: '9. Agent 多代理架构',
    modules: ['assistant', 'coordinator'],
    prompt: `Write a guide to Claude Code's multi-agent architecture. Cover:
- Agent definition and loading
- Agent dispatch and coordination
- Sub-agent execution
- Agent-to-agent communication
Include code excerpts and architecture diagrams. Format in Chinese Markdown.`,
  },
  {
    file: 'walkthrough/conversation-flow.md',
    title: '10. 完整对话处理链路',
    modules: ['assistant', 'hooks'],
    prompt: `Write a detailed walkthrough of the complete conversation processing pipeline. Cover:
- User input reception
- Message processing in assistant/
- Hook execution
- Response generation and rendering
- Message history management
Include complete call chains with file:line references. Format in Chinese Markdown.`,
  },
  {
    file: 'walkthrough/file-edit-pipeline.md',
    title: '11. 文件编辑管线',
    modules: ['tools'],
    prompt: `Write a detailed walkthrough of the file editing pipeline. Cover:
- File read flow
- File write flow
- File edit flow (diff-based editing)
- Permission checking for file operations
- Edit conflict resolution
Include call chains with file:line references. Format in Chinese Markdown.`,
  },
  {
    file: 'walkthrough/agent-dispatch.md',
    title: '12. Agent 调度与执行',
    modules: ['tools', 'coordinator'],
    prompt: `Write a detailed walkthrough of agent dispatch and execution. Cover:
- How AgentTool processes agent creation requests
- Agent lifecycle: creation → execution → result collection
- Worktree isolation for agents
- Coordinator role in multi-agent scenarios
Include call chains with file:line references. Format in Chinese Markdown.`,
  },
  {
    file: 'walkthrough/permission-model.md',
    title: '13. 权限校验模型',
    modules: ['hooks', 'context'],
    prompt: `Write a detailed walkthrough of Claude Code's permission model. Cover:
- Permission modes (ask, auto-edit, full-auto)
- useCanUseTool hook
- Tool permission checking
- Sandbox and security boundaries
- Plan mode restrictions
Include call chains with file:line references. Format in Chinese Markdown.`,
  },
  {
    file: 'walkthrough/plugin-extension.md',
    title: '14. 插件与扩展机制',
    modules: ['plugins'],
    prompt: `Write a detailed walkthrough of Claude Code's plugin and extension system. Cover:
- Plugin loading mechanism
- Bundled plugins
- Plugin hooks and middleware
- MCP server configuration via plugins
- Custom tool registration via plugins
Include call chains with file:line references. Format in Chinese Markdown.`,
  },
]

function getLLMConfig() {
  const baseUrl = process.env.LLM_BASE_URL
  const model = process.env.LLM_MODEL
  const apiKey = process.env.LLM_API_KEY
  if (!baseUrl || !model || !apiKey) {
    console.error('Missing LLM config. Set LLM_BASE_URL, LLM_MODEL, LLM_API_KEY in .env')
    process.exit(1)
  }
  return { baseUrl, model, apiKey }
}

async function generateChapter(chapter: typeof chapters[0], index: ModuleIndex, { baseUrl, model, apiKey }: ReturnType<typeof getLLMConfig>) {

  let moduleContext = ''
  if (chapter.modules) {
    for (const modName of chapter.modules) {
      const mod = index.modules.find(m => m.name === modName || m.path === `src/${modName}/`)
      if (mod) {
        moduleContext += `\n## Module: ${mod.name}\n`
        moduleContext += `Path: ${mod.path}\n`
        moduleContext += `Files: ${mod.fileCount}, Lines: ${mod.lineCount}\n`
        moduleContext += `Description: ${mod.description}\n`
        for (const exp of mod.exports.slice(0, 10)) {
          moduleContext += `  - ${exp.kind} ${exp.name} (${exp.file}:${exp.line})\n`
        }
      }
    }
  }

  const systemPrompt = `You are a technical writer creating educational content for a Claude Code source code study platform.
Write in Chinese (Simplified). Use Markdown format.
When referencing source code, use the format: src/path/to/file.ts:line
Structure your content with clear headings, code blocks, and explanations.`

  const userPrompt = `${chapter.prompt}

${moduleContext ? `Relevant module data:\n${moduleContext}` : ''}

Write the complete article. Use these custom components where appropriate:
- <CodeLink filePath="src/file.ts" :line="123" /> for source references
- <CallChain :chain="[...]" /> for call chain visualization (provide array of {function, file, line, description})
- <ModuleGraph moduleName="tools" /> for dependency visualization

Do NOT use generic placeholders. Write real, specific content based on the module data provided.`

  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 8000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!resp.ok) {
    const err = await resp.text()
    console.error(`API error for ${chapter.file}: ${err}`)
    return false
  }

  const data = await resp.json()
  const content = data.choices?.[0]?.message?.content || ''
  const markdown = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim()

  const outputPath = join(DOCS_DIR, chapter.file)
  const dir = dirname(outputPath)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  writeFileSync(outputPath, `# ${chapter.title}\n\n${markdown}\n`)
  console.log(`Generated: ${chapter.file} (${content.length} chars)`)
  return true
}

async function main() {
  const indexPath = join(DATA_DIR, 'index.json')
  if (!existsSync(indexPath)) {
    console.error('index.json not found. Run "bun run analyze && bun run generate:index" first.')
    process.exit(1)
  }

  const index: ModuleIndex = JSON.parse(readFileSync(indexPath, 'utf-8'))
  const llmConfig = getLLMConfig()
  const args = process.argv.slice(2)
  const skipExisting = args.includes('--skip-existing')
  const targetChapter = args.find(a => !a.startsWith('--'))

  const chaptersToGenerate = targetChapter
    ? chapters.filter(c => c.file === targetChapter)
    : chapters

  console.log(`Using LLM: ${llmConfig.model} @ ${llmConfig.baseUrl}`)
  console.log(`Generating ${chaptersToGenerate.length} chapter(s)...${skipExisting ? ' (skip existing)' : ''}`)
  console.log('Press Ctrl+C to stop at any time. Each chapter will be saved as it completes.\n')

  for (const chapter of chaptersToGenerate) {
    const outputPath = join(DOCS_DIR, chapter.file)
    if (!targetChapter && skipExisting && existsSync(outputPath)) {
      console.log(`\n--- Skipping (exists): ${chapter.title} ---`)
      continue
    }
    console.log(`\n--- Generating: ${chapter.title} ---`)
    await generateChapter(chapter, index, llmConfig)
  }

  console.log('\nDone! Review the generated content in docs/zh/')
}

await main()
