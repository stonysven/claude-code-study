# 3. Tool 系统

# Claude Code 工具系统完全指南

<ModuleGraph moduleName="tools" />

Claude Code 的工具系统是其核心架构之一，为 AI 代理提供了与文件系统、Shell 环境、代码搜索等外部世界交互的能力。本文将深入剖析工具系统的接口设计、注册调度机制、各内置工具的实现细节，以及权限控制模型。

---

## 一、Tool 接口定义

### 1.1 核心接口

Claude Code 中每个工具都必须实现统一的 `Tool` 接口。该接口定义了工具的元数据、输入输出 Schema 以及执行逻辑：

```typescript
interface Tool {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, JSONSchema>
    required?: string[]
  }
  outputSchema?: {
    type: "object"
    properties: Record<string, JSONSchema>
  }
  execute(params: any, context: ToolContext): Promise<ToolResult>
}
```

每个工具通过 `inputSchema` 声明其接受的参数结构，使用 JSON Schema 格式。以 <CodeLink filePath="src/tools/NotebookEditTool/NotebookEditTool.ts" :line="30" /> 中的 `inputSchema` 为例，它定义了 `file_path`、`old_string`、`new_string` 等必要字段。

### 1.2 工具输出类型

工具执行后返回 `ToolResult` 对象。部分工具定义了专用的输出类型，例如 <CodeLink filePath="src/tools/TaskGetTool/TaskGetTool.ts" :line="36" /> 中定义的 `Output` 类型：

```typescript
type Output = {
  content: string
  task?: TaskInfo
}
```

这种模式允许工具在返回文本内容的同时，附加结构化元数据供上层消费。

### 1.3 工具上下文 (ToolContext)

执行上下文 `ToolContext` 贯穿所有工具调用，承载了：

- **会话信息**：当前对话 ID、消息历史
- **权限状态**：已授权的工具和操作范围
- **工作目录**：文件操作的基准路径
- **沙箱配置**：Shell 执行的环境限制

---

## 二、Tool 注册与调度

### 2.1 工具注册

工具系统采用集中注册模式。所有内置工具在初始化阶段被收集到一个 `ToolRegistry` 中：

```typescript
class ToolRegistry {
  private tools: Map<string, Tool> = new Map()

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values())
  }
}
```

工具名称通过常量统一管理，如 <CodeLink filePath="src/tools/TaskGetTool/constants.ts" :line="1" /> 中的 `TASK_GET_TOOL_NAME` 和 <CodeLink filePath="src/tools/NotebookEditTool/constants.ts" :line="2" /> 中的 `NOTEBOOK_EDIT_TOOL_NAME`，确保名称在注册、调度和提示词生成三个环节中一致。

### 2.2 工具调度流程

当 Claude 决定调用某个工具时，调度器执行以下流程：

<CallChain :chain="[
  { function: 'handleToolUse', file: 'src/agent/Agent.ts', line: 180, description: '解析 LLM 返回的 tool_use 块' },
  { function: 'dispatchTool', file: 'src/tools/dispatcher.ts', line: 45, description: '根据工具名查找注册表' },
  { function: 'checkPermission', file: 'src/tools/permission.ts', line: 72, description: '执行权限检查' },
  { function: 'tool.execute', file: 'src/tools/*/index.ts', line: 0, description: '调用具体工具的 execute 方法' },
  { function: 'formatResult', file: 'src/tools/dispatcher.ts', line: 98, description: '将结果格式化为 LLM 可消费的文本' }
]" />

### 2.3 Prompt 注入

每个工具的 `description` 和 `PROMPT` 被注入到系统提示词中，指导 Claude 正确使用工具。以 <CodeLink filePath="src/tools/TaskGetTool/prompt.ts" :line="1" /> 和 <CodeLink filePath="src/tools/TaskGetTool/prompt.ts" :line="3" /> 为例：

```typescript
// prompt.ts
const DESCRIPTION = "获取当前或指定任务的详细信息"
const PROMPT = `使用此工具查看任务的当前状态、描述和相关上下文...`
```

<CodeLink filePath="src/tools/NotebookEditTool/prompt.ts" :line="1" /> 和 <CodeLink filePath="src/tools/NotebookEditTool/prompt.ts" :line="3" /> 遵循相同的模式，将 `DESCRIPTION` 作为简述，`PROMPT` 作为详细使用指南。

---

## 三、文件操作工具

文件操作工具是 Claude Code 中最基础也最频繁使用的工具类别，包含三个核心工具。

### 3.1 FileReadTool

**职责**：读取文件内容并返回给 Claude。

```typescript
const FileReadTool: Tool = {
  name: "file_read",
  description: "读取指定路径的文件内容",
  inputSchema: {
    type: "object",
    properties: {
      file_path: {
        type: "string",
        description: "要读取的文件路径（相对于工作目录或绝对路径）"
      },
      offset: {
        type: "number",
        description: "从第几行开始读取（可选）"
      },
      limit: {
        type: "number",
        description: "最多读取多少行（可选）"
      }
    },
    required: ["file_path"]
  },
  async execute(params, context) {
    const resolvedPath = resolvePath(params.file_path, context.cwd)
    const content = await fs.readFile(resolvedPath, "utf-8")
    // 根据 offset 和 limit 进行行级截取
    const lines = content.split("\n")
    const sliced = lines.slice(
      params.offset ?? 0,
      (params.offset ?? 0) + (params.limit ?? lines.length)
    )
    return {
      content: sliced.join("\n"),
      metadata: { totalLines: lines.length, returnedLines: sliced.length }
    }
  }
}
```

**关键设计**：
- 支持 `offset` + `limit` 实现行级分页读取，避免大文件一次性传输超出上下文窗口
- 路径解析支持相对路径（基于 `context.cwd`）和绝对路径
- 返回元数据告知 Claude 文件总行数，辅助其判断是否需要继续读取

### 3.2 FileWriteTool

**职责**：将内容写入文件，支持创建新文件和完全覆盖已有文件。

<CallChain :chain="[
  { function: 'execute', file: 'src/tools/FileWriteTool/FileWriteTool.ts', line: 40, description: '接收写入参数' },
  { function: 'resolvePath', file: 'src/tools/utils/path.ts', line: 15, description: '解析并规范化文件路径' },
  { function: 'validateWrite', file: 'src/tools/permission.ts', line: 120, description: '验证写入权限和路径安全' },
  { function: 'ensureDirectory', file: 'src/tools/utils/fs.ts', line: 28, description: '自动创建不存在的父目录' },
  { function: 'fs.writeFile', file: 'node:fs/promises', line: 0, description: '执行实际文件写入' }
]" />

```typescript
const FileWriteTool: Tool = {
  name: "file_write",
  description: "将内容写入文件，如果文件不存在则创建",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      content: { type: "string", description: "要写入的完整内容" },
      encoding: { type: "string", default: "utf-8" }
    },
    required: ["file_path", "content"]
  },
  async execute(params, context) {
    const resolvedPath = resolvePath(params.file_path, context.cwd)
    await ensureDirectory(dirname(resolvedPath))
    await fs.writeFile(resolvedPath, params.content, params.encoding ?? "utf-8")
    return {
      content: `已成功写入 ${params.file_path}（${params.content.split("\n").length} 行）`
    }
  }
}
```

### 3.3 FileEditTool

**职责**：对文件执行精确的字符串替换编辑，是 Claude Code 最精细的文件修改工具。

```typescript
const FileEditTool: Tool = {
  name: "file_edit",
  description: "通过精确匹配旧字符串并替换为新字符串来编辑文件",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string" },
      old_string: {
        type: "string",
        description: "要被替换的精确文本（必须与文件内容完全匹配）"
      },
      new_string: {
        type: "string",
        description: "替换后的新文本"
      }
    },
    required: ["file_path", "old_string", "new_string"]
  },
  async execute(params, context) {
    const resolvedPath = resolvePath(params.file_path, context.cwd)
    const content = await fs.readFile(resolvedPath, "utf-8")

    if (!content.includes(params.old_string)) {
      return {
        content: "",
        isError: true,
        error: "未找到匹配的文本。old_string 必须与文件内容完全一致，包括空格和换行。"
      }
    }

    const newContent = content.replace(params.old_string, params.new_string)
    await fs.writeFile(resolvedPath, newContent, "utf-8")

    return {
      content: `已成功编辑 ${params.file_path}`
    }
  }
}
```

**三种文件工具的协作模式**：

| 场景 | 推荐工具 | 原因 |
|------|---------|------|
| 首次查看文件 | FileReadTool | 只读操作，无副作用 |
| 创建新文件 | FileWriteTool | 需要完整内容 |
| 修改已有文件 | FileEditTool | 精确替换，避免意外覆盖 |
| 大规模重构 | FileWriteTool | 当替换范围超过文件一半时更可靠 |

### 3.4 NotebookEditTool（特殊文件编辑）

<CodeLink filePath="src/tools/NotebookEditTool/NotebookEditTool.ts" :line="30" /> 中的 `inputSchema` 和 <CodeLink filePath="src/tools/NotebookEditTool/NotebookEditTool.ts" :line="60" /> 中的 `outputSchema` 表明，NotebookEditTool 是针对 Jupyter Notebook (.ipynb) 文件的专用编辑工具。它定义了不同于纯文本编辑的输入输出结构，需要处理 cell 级别的操作（如添加、删除、修改代码单元），而非简单的字符串替换。

---

## 四、Shell 执行：BashTool

### 4.1 概述

BashTool 是 Claude Code 与系统 Shell 交互的桥梁，允许 Claude 执行任意 Shell 命令。这也是权限控制最严格的工具。

### 4.2 核心实现

```typescript
const BashTool: Tool = {
  name: "bash",
  description: "执行 Bash Shell 命令并返回输出",
  inputSchema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "要执行的 Bash 命令"
      },
      timeout: {
        type: "number",
        description: "超时时间（毫秒），默认 120000",
        default: 120000
      },
      workingDirectory: {
        type: "string",
        description: "命令执行的工作目录（可选，默认为项目根目录）"
      }
    },
    required: ["command"]
  },
  async execute(params, context) {
    return spawnCommand(params.command, {
      cwd: params.workingDirectory ?? context.cwd,
      timeout: params.timeout ?? 120000,
      env: { ...process.env, ...context.shellEnv }
    })
  }
}
```

### 4.3 命令执行链路

<CallChain :chain="[
  { function: 'execute', file: 'src/tools/BashTool/BashTool.ts', line: 55, description: '接收命令参数' },
  { function: 'spawnCommand', file: 'src/tools/BashTool/spawn.ts', line: 20, description: '创建子进程' },
  { function: 'childProcess.spawn', file: 'node:child_process', line: 0, description: '启动 bash -c 命令' },
  { function: 'collectOutput', file: 'src/tools/BashTool/spawn.ts', line: 65, description: '流式收集 stdout/stderr' },
  { function: 'enforceTimeout', file: 'src/tools/BashTool/spawn.ts', line: 90, description: '超时则 SIGKILL 进程' },
  { function: 'formatOutput', file: 'src/tools/BashTool/spawn.ts', line: 110, description: '格式化退出码和输出' }
]" />

### 4.4 关键安全机制

- **超时强制终止**：默认 120 秒超时，超时后发送 `SIGKILL` 信号确保进程终止
- **输出截断**：stdout/stderr 各有最大缓冲区限制（通常 100KB），防止大输出耗尽内存
- **环境隔离**：可注入受限的 `shellEnv`，而非直接使用完整 `process.env`
- **非交互模式**：使用 `bash -c` 执行，不支持交互式输入（如 `vim`、`ssh` 等需要 TTY 的命令）

---

## 五、代码搜索：GlobTool 与 GrepTool

### 5.1 GlobTool —— 文件模式匹配

GlobTool 基于 glob 模式搜索文件路径，帮助 Claude 定位项目中的文件。

```typescript
const GlobTool: Tool = {
  name: "glob",
  description: "使用 glob 模式搜索文件路径",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob 模式，如 '**/*.ts'、'src/**/*.test.ts'"
      },
      path: {
        type: "string",
        description: "搜索的根目录（可选）"
      },
      excludePatterns: {
        type: "array",
        items: { type: "string" },
        description: "要排除的 glob 模式列表"
      }
    },
    required: ["pattern"]
  },
  async execute(params, context) {
    const root = params.path ?? context.cwd
    const files = await glob(params.pattern, {
      cwd: root,
      ignore: [
        "node_modules/**",
        ".git/**",
        "dist/**",
        "build/**",
        ...(params.excludePatterns ?? [])
      ]
    })
    // 限制返回数量，防止结果过多
    const truncated = files.slice(0, 200)
    return {
      content: truncated.join("\n"),
      metadata: { totalMatches: files.length, truncated: files.length > 200 }
    }
  }
}
```

**设计要点**：
- 自动排除 `node_modules`、`.git` 等无关目录
- 结果数量上限为 200 条，超出时通过 `metadata.truncated` 标记
- 支持用户自定义排除模式

### 5.2 GrepTool —— 内容正则搜索

GrepTool 在文件内容中搜索匹配正则表达式的行，是代码语义定位的核心工具。

```typescript
const GrepTool: Tool = {
  name: "grep",
  description: "在文件中搜索匹配正则表达式的文本行",
  inputSchema: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "正则表达式模式"
      },
      path: {
        type: "string",
        description: "搜索的根目录"
      },
      includePatterns: {
        type: "array",
        items: { type: "string" },
        description: "只搜索匹配这些 glob 模式的文件"
      },
      excludePatterns: {
        type: "array",
        items: { type: "string" },
        description: "排除匹配这些 glob 模式的文件"
      },
      maxResults: {
        type: "number",
        description: "最大返回结果数，默认 100",
        default: 100
      }
    },
    required: ["pattern"]
  },
  async execute(params, context) {
    const results = await ripgrepSearch(params.pattern, {
      cwd: params.path ?? context.cwd,
      include: params.includePatterns,
      exclude: [
        "node_modules",
        ".git",
        ...(params.excludePatterns ?? [])
      ],
      maxResults: params.maxResults ?? 100
    })

    const formatted = results.map(r =>
      `${r.file}:${r.lineNumber}:${r.line.trim()}`
    )

    return {
      content: formatted.join("\n"),
      metadata: { totalMatches: results.total, truncated: results.truncated }
    }
  }
}
```

### 5.3 搜索工具协作模式

Claude Code 的典型代码定位流程：

<CallChain :chain="[
  { function: 'GlobTool.execute', file: 'src/tools/GlobTool/GlobTool.ts', line: 35, description: '先用 glob 定位文件：**/*Tool.ts' },
  { function: 'GrepTool.execute', file: 'src/tools/GrepTool/GrepTool.ts', line: 42, description: '再用 grep 精确搜索：class.*Tool' },
  { function: 'FileReadTool.execute', file: 'src/tools/FileReadTool/FileReadTool.ts', line: 30, description: '最后读取目标文件内容' }
]" />

这种 **"先定位文件，再搜索内容，最后读取详情"** 的三级搜索模式，是 Claude Code 高效处理大型代码库的关键策略。

---

## 六、Agent 子工具：AgentTool

### 6.1 概述

AgentTool 是 Claude Code 中最独特的工具——它允许 Claude 创建子代理来处理复杂任务。这实现了 **代理嵌套** 的架构模式。

### 6.2 核心设计

```typescript
const AgentTool: Tool = {
  name: "agent",
  description: "创建一个子代理来执行子任务，子代理拥有独立的工具访问权限",
  inputSchema: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "分配给子代理的任务描述"
      },
      tools: {
        type: "array",
        items: { type: "string" },
        description: "子代理可使用的工具列表（可选，默认继承父代理工具集的子集）"
      },
      maxTurns: {
        type: "number",
        description: "子代理的最大交互轮数，默认 10",
        default: 10
      },
      context: {
        type: "string",
        description: "传递给子代理的上下文信息（可选）"
      }
    },
    required: ["task"]
  },
  async execute(params, context) {
    const subAgent = createSubAgent({
      parentSession: context.sessionId,
      task: params.task,
      availableTools: params.tools ?? getDefaultSubTools(),
      maxTurns: params.maxTurns ?? 10,
      inheritedContext: params.context
    })

    const result = await subAgent.run()
    return {
      content: result.summary,
      metadata: {
        turnsUsed: result.turns,
        toolsCalled: result.toolCalls,
        completed: result.completed
      }
    }
  }
}
```

### 6.3 子代理执行链路

<CallChain :chain="[
  { function: 'execute', file: 'src/tools/AgentTool/AgentTool.ts', line: 50, description: '接收子任务参数' },
  { function: 'createSubAgent', file: 'src/agent/SubAgent.ts', line: 20, description: '创建独立子代理实例' },
  { function: 'subAgent.run', file: 'src/agent/SubAgent.ts', line: 65, description: '子代理自主执行任务循环' },
  { function: 'subAgent.executeTool', file: 'src/agent/SubAgent.ts', line: 95, description: '子代理调用工具（嵌套调度）' },
  { function: 'returnToParent', file: 'src/agent/SubAgent.ts', line: 130, description: '汇总结果返回父代理' }
]" />

### 6.4 子代理的关键约束

| 约束项 | 说明 |
|--------|------|
| **工具限制** | 子代理默认只能使用安全工具子集（如 file_read、grep、glob），不包含 bash 和 file_write |
| **轮次上限** | 通过 `maxTurns` 限制防止无限循环，默认 10 轮 |
| **上下文隔离** | 子代理不继承父代理的对话历史，通过 `context` 参数传递必要信息 |
| **结果聚合** | 子代理返回摘要而非完整日志，避免上下文膨胀 |

### 6.5 TaskGetTool —— 子任务状态查询

<CodeLink filePath="src/tools/TaskGetTool/TaskGetTool.ts" :line="38" /> 中定义的 `TaskGetTool` 与 AgentTool 配合使用。当 Claude 创建子任务后，可以通过 TaskGetTool 查询子任务的状态、进度和结果：

```typescript
// TaskGetTool 允许父代理检查子代理的执行状态
// 输出类型定义于 src/tools/TaskGetTool/TaskGetTool.ts:36
// 包含 content（状态描述）和可选的 task（结构化任务信息）
```

---

## 七、工具权限模型

### 7.1 权限层级

Claude Code 采用 **三层权限模型**：

```
┌─────────────────────────────────────────┐
│  Layer 1: 自动允许           │
│  - file_read, glob, grep                 │
│  - 无副作用的只读操作                      │
├─────────────────────────────────────────┤
│  Layer 2: 一次性确认       │
│  - file_write, file_edit                 │
│  - notebook_edit                         │
│  - 每次写入前需用户确认                    │
├─────────────────────────────────────────┤
│  Layer 3: 严格审批           │
│  - bash                                  │
│  - agent（创建子代理）                     │
│  - 可配置为会话级允许或每次确认             │
└─────────────────────────────────────────┘
```

### 7.2 权限检查实现

```typescript
// 权限检查在调度层执行
async function checkPermission(
  tool: Tool,
  params: any,
  context: ToolContext
): Promise<PermissionDecision> {
  const toolName = tool.name

  // Layer 1: 自动允许
  if (AUTO_ALLOW_TOOLS.includes(toolName)) {
    return { allowed: true, auto: true }
  }

  // Layer 2: 会话级已授权检查
  const sessionAuth = context.authorizedTools.get(toolName)
  if (sessionAuth) {
    // 检查参数范围是否在授权范围内
    if (isWithinScope(params, sessionAuth.scope)) {
      return { allowed: true, auto: false, sessionAuthorized: true }
    }
  }

  // Layer 3: 需要 UI 确认
  return {
    allowed: false,
    requiresConfirmation: true,
    prompt: buildPermissionPrompt(toolName, params)
  }
}
```

### 7.3 Bash 特殊权限规则

BashTool 拥有最细粒度的权限控制：

```typescript
function checkBashPermission(command: string, context: ToolContext) {
  // 解析命令，提取基础命令名
  const baseCommand = extractBaseCommand(command)

  // 某些命令被完全禁止
  if (FORBIDDEN_COMMANDS.includes(baseCommand)) {
    return { allowed: false, blocked: true, reason: "危险命令被禁止" }
  }

  // 某些只读命令可自动允许
  if (SAFE_READONLY_COMMANDS.includes(baseCommand)) {
    return { allowed: true, auto: true }
  }

  // 网络相关命令需要额外确认
  if (NETWORK_COMMANDS.includes(baseCommand)) {
    return { allowed: false, requiresConfirmation: true, risk: "network" }
  }

  // 默认需要用户确认
  return { allowed: false, requiresConfirmation: true }
}
```

**禁止命令列表示例**：`rm -rf /`、`mkfs`、`dd if=...`、`chmod 777 /`
**安全只读命令**：`ls`、`cat`、`head`、`tail`、`wc`、`find`（无 `-delete`）
**网络命令**：`curl`、`wget`、`nc`、`ssh`、`npm install`、`pip install`

### 7.4 路径安全验证

文件操作工具在执行前会进行路径安全检查：

<CallChain :chain="[
  { function: 'resolvePath', file: 'src/tools/utils/path.ts', line: 15, description: '解析路径为绝对路径' },
  { function: 'isWithinProject', file: 'src/tools/utils/path.ts', line: 32, description: '检查路径是否在项目根目录下' },
  { function: 'checkSymlink', file: 'src/tools/utils/path.ts', line: 48, description: '检测符号链接是否指向项目外' },
  { function: 'validatePath', file: 'src/tools/permission.ts', line: 85, description: '综合路径安全判定' }
]" />

关键规则：
- 路径必须解析到项目根目录或其子目录下（可配置白名单扩展）
- 符号链接的目标路径也需要在允许范围内
- 拒绝包含 `..` 的路径规范化后逃逸出项目目录的尝试

### 7.5 权限持久化与会话管理

```typescript
interface PermissionState {
  // 会话级授权记录
  authorizedTools: Map<string, {
    scope: ToolScope
    grantedAt: number
    toolUseCount: number
  }>

  // "始终允许"配置（跨会话持久化）
  alwaysAllow: Set<string>

  // "始终拒绝"配置
  alwaysDeny: Set<string>
}

interface ToolScope {
  // 对文件工具：允许的路径前缀
  pathPrefix?: string[]
  // 对 bash：允许的命令模式
  commandPatterns?: RegExp[]
}
```

用户可以通过 CLI 配置将某些工具设为"始终允许"，这些设置会被持久化到本地配置文件中，跨会话生效。

---

## 八、工具系统架构总结

### 8.1 整体数据流

```
LLM 输出 tool_use
       │
       ▼
┌──────────────┐
│   Dispatcher  │  ← 工具注册表查找
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Permission   │  ← 三层权限检查
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  Tool.execute │  ← 具体工具执行
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Result Format │  ← 统一结果格式化
└──────┬───────┘
       │
       ▼
LLM 接收 tool_result
```

### 8.2 工具分类总览

| 分类 | 工具 | 权限层级 | 核心特征 |
|------|------|---------|---------|
| 文件读取 | FileReadTool | 自动允许 | 支持行级分页 |
| 文件写入 | FileWriteTool | 一次性确认 | 自动创建目录 |
| 文件编辑 | FileEditTool | 一次性确认 | 精确字符串替换 |
| Notebook编辑 | NotebookEditTool | 一次性确认 | Cell级操作 |
| Shell执行 | BashTool | 严格审批 | 超时/截断/命令分类 |
| 文件搜索 | GlobTool | 自动允许 | 模式匹配+排除 |
| 内容搜索 | GrepTool | 自动允许 | 正则+行级结果 |
| 子代理 | AgentTool | 严格审批 | 独立上下文+轮次限制 |
| 任务查询 | TaskGetTool | 自动允许 | 子任务状态检查 |

### 8.3 设计哲学

Claude Code 工具系统的设计体现了几个核心原则：

1. **最小权限原则**：默认只读操作自动允许，写操作需确认，危险操作严格审批
2. **渐进式信任**：用户可以在会话中将工具从"每次确认"提升为"会话允许"
3. **防御性编程**：所有工具都有输出截断、超时保护、路径验证等安全措施
4. **组合优于单体**：通过 GlobTool + GrepTool + FileReadTool 的组合，而非一个"搜索并读取"的大工具，给予 Claude 更灵活的搜索策略
5. **代理递归**：AgentTool 实现了工具调用工具的递归能力，但通过轮次限制和工具子集确保递归可终止

tools 模块共包含 **186 个文件**、**50990 行代码**，构成了 Claude Code 与外部世界交互的完整接口层。理解这套工具系统，是深入掌握 Claude Code 架构的关键一步。
