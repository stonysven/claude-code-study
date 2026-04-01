# 1. 整体架构概览

# Claude Code CLI 架构全景解析

## 一、高层架构图

以下是供 SVG 创建使用的架构描述：

```
┌─────────────────────────────────────────────────────────────┐
│                      用户终端                        │
└──────────────────────────┬──────────────────────────────────┘
                           │ stdin / stdout
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    CLI 入口层                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │ main.tsx    │─▶│ cli.ts       │─▶│ config.ts          │  │
│  │ (React挂载) │  │ (参数解析)    │  │ (配置加载/合并)     │  │
│  └─────────────┘  └──────────────┘  └────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ 初始化上下文
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    核心会话引擎                               │
│  ┌──────────────┐  ┌────────────────┐  ┌─────────────────┐  │
│  │ Conversation │  │ MessageBuilder │  │ PermissionGuard │  │
│  │ Manager      │  │ (消息构造)      │  │ (权限校验)       │  │
│  └──────┬───────┘  └───────┬────────┘  └────────┬────────┘  │
└─────────┼──────────────────┼────────────────────┼───────────┘
          │                  │                    │
          ▼                  ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                    工具执行层                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ ReadFile │ │ WriteFile│ │ Shell    │ │ EditFile       │  │
│  │ Tool     │ │ Tool     │ │ Tool     │ │ Tool           │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────────┐  │
│  │ GlobTool │ │ GrepTool │ │ LSProj   │ │ TodoRead/Write │  │
│  └──────────┘ └──────────┘ └──────────┘ └────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ 工具结果
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    API 通信层                                 │
│  ┌──────────────┐  ┌──────────────────┐  ┌───────────────┐  │
│  │ StreamHandler│  │ RetryMiddleware  │  │ TokenCounter  │  │
│  │ (SSE流处理)   │  │ (重试/退避)      │  │ (Token计数)   │  │
│  └──────────────┘  └──────────────────┘  └───────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP/SSE
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                 Anthropic Claude API                         │
└─────────────────────────────────────────────────────────────┘
```

**SVG 创建说明**：使用纵向分层布局，每层用圆角矩形包裹，层间用带箭头的连线标注数据流方向。配色建议：入口层用蓝灰色、会话引擎用深蓝、工具层用绿色系、API层用紫色。工具模块内部可用网格排列，体现并行注册关系。

---

## 二、核心模块及其职责

### 2.1 入口与启动模块

入口文件 <CodeLink filePath="src/main.tsx" :line="1" /> 是整个 CLI 的起点。它负责：

- **React 终端渲染挂载**：使用 Ink 框架将 React 组件树渲染到终端
- **进程信号监听**：捕获 `SIGINT`、`SIGTERM` 实现优雅退出
- **全局错误边界**：防止未捕获异常导致终端状态损坏

```
入口职责链：
main.tsx → 创建 React 根节点 → 渲染 <App /> → 触发 CLI 初始化
```

### 2.2 CLI 参数解析模块

<CodeLink filePath="src/cli.ts" :line="1" /> 负责命令行参数的解析与验证：

| 参数 | 用途 | 默认值 |
|------|------|--------|
| `--model` | 指定 Claude 模型版本 | `claude-sonnet-4-20250514` |
| `--allowedTools` | 限制可用工具白名单 | 全部允许 |
| `--max-turns` | 单次会话最大轮次 | 无限制 |
| `--system-prompt` | 自定义系统提示词 | 内置默认 |
| `--print` | 非交互模式，输出最终结果 | `false` |
| `--resume` | 从指定会话 ID 恢复 | 无 |

该模块使用轻量级参数解析器，将原始 `process.argv` 转化为类型安全的配置对象。

### 2.3 会话管理引擎

这是 Claude Code 的**核心中枢**，负责维护完整的对话状态机：

<CodeLink filePath="src/conversation/ConversationManager.ts" :line="1" />

**核心职责**：
- 维护消息历史（`Message[]`），包含 `user`、`assistant`、`tool_result` 三种角色
- 管理工具调用的聚合与结果收集
- 实现自动续写循环（agentic loop）：模型输出工具调用 → 执行工具 → 将结果喂回模型 → 重复直到模型输出纯文本
- 上下文窗口管理：当 Token 接近上限时，对早期消息进行摘要压缩

### 2.4 工具系统

<ModuleGraph moduleName="tools" />

工具系统是 Claude Code 与本地环境交互的唯一通道。每个工具遵循统一接口：

```typescript
interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute(params: ToolParams, context: ToolContext): Promise<ToolResult>;
}
```

**关键工具清单**：

| 工具名 | 文件位置 | 核心功能 |
|--------|----------|----------|
| `Read` | <CodeLink filePath="src/tools/read.ts" :line="1" /> | 读取文件内容，支持行范围、编码检测 |
| `Write` | <CodeLink filePath="src/tools/write.ts" :line="1" /> | 创建或完整覆写文件，含自动格式化 |
| `Edit` | <CodeLink filePath="src/tools/edit.ts" :line="1" /> | 基于搜索-替换模式的精确文件编辑 |
| `Bash` | <CodeLink filePath="src/tools/bash.ts" :line="1" /> | 执行 Shell 命令，支持超时与输出截断 |
| `Glob` | <CodeLink filePath="src/tools/glob.ts" :line="1" /> | 基于 glob 模式的文件搜索 |
| `Grep` | <CodeLink filePath="src/tools/grep.ts" :line="1" /> | 基于 ripgrep 的内容搜索 |
| `LS` | <CodeLink filePath="src/tools/ls.ts" :line="1" /> | 列出目录结构，支持深度控制 |
| `TodoRead` / `TodoWrite` | <CodeLink filePath="src/tools/todo.ts" :line="1" /> | 内置任务列表管理 |
| `NotebookRead` / `NotebookEdit` | <CodeLink filePath="src/tools/notebook.ts" :line="1" /> | Jupyter Notebook 读写支持 |

### 2.5 权限守护模块

<CodeLink filePath="src/permissions/PermissionGuard.ts" :line="1" />

这是安全架构的核心。每次工具调用必须经过权限检查：

- **白名单检查**：工具是否在 `allowedTools` 列表中
- **路径校验**：文件操作是否越界出工作目录
- **危险操作确认**：`Write`、`Bash`（含破坏性命令）需要用户显式确认
- **权限缓存**：用户选择"始终允许"后，同一工具+路径模式会被缓存

### 2.6 API 通信层

<CodeLink filePath="src/api/StreamHandler.ts" :line="1" />

- 使用 **Server-Sent Events (SSE)** 接收流式响应
- 将 `content_block_delta` 事件实时转发给 UI 层
- 将 `tool_use` 事件路由至工具执行层
- 实现指数退避重试策略
- 维护请求级 Token 计数器，用于上下文窗口预算管理

### 2.7 终端 UI 层

基于 **Ink**（React for CLI）构建，主要组件：

- `<App />`：顶层容器，管理全局状态
- `<ConversationView />`：消息列表渲染，支持 Markdown、代码高亮
- `<InputView />`：用户输入区，支持多行编辑
- `<ToolExecutionView />`：工具执行状态实时展示（旋转器、输出预览）
- `<PermissionPrompt />`：权限确认弹窗

---

## 三、数据流：从用户输入到最终响应

下面是完整的数据流动路径：

<CallChain :chain="[
  { function: 'handleUserInput', file: 'src/ui/InputView.tsx', line: 45, description: '用户按下回车，原始文本进入处理管线' },
  { function: 'buildUserMessage', file: 'src/conversation/MessageBuilder.ts', line: 78, description: '将原始文本包装为 UserMessage，注入系统上下文' },
  { function: 'addToHistory', file: 'src/conversation/ConversationManager.ts', line: 112, description: '消息追加到对话历史数组' },
  { function: 'checkPermissions', file: 'src/permissions/PermissionGuard.ts', line: 34, description: '预检查本轮是否可能需要危险工具（提前拦截）' },
  { function: 'createStreamRequest', file: 'src/api/StreamHandler.ts', line: 56, description: '构造 Messages API 请求体，包含完整历史和工具定义' },
  { function: 'sendToAPI', file: 'src/api/StreamHandler.ts', line: 89, description: '发起 SSE 流式请求到 Anthropic API' },
  { function: 'onToolUse', file: 'src/api/StreamHandler.ts', line: 134, description: '接收到 tool_use content block，解析工具名和参数' },
  { function: 'executeTool', file: 'src/tools/ToolExecutor.ts', line: 67, description: '根据工具名路由到对应工具的 execute 方法' },
  { function: 'validateAndRun', file: 'src/permissions/PermissionGuard.ts', line: 89, description: '逐项校验工具参数合法性，必要时弹出确认' },
  { function: 'tool.execute()', file: 'src/tools/edit.ts', line: 45, description: '工具实际执行（如文件编辑、Shell 执行）' },
  { function: 'appendToolResult', file: 'src/conversation/ConversationManager.ts', line: 156, description: '将 tool_result 消息追加到历史' },
  { function: 'continueLoop', file: 'src/conversation/ConversationManager.ts', line: 189, description: '判断是否需要继续循环（模型是否又发起了工具调用）' },
  { function: 'onTextDelta', file: 'src/api/StreamHandler.ts', line: 112, description: '接收到纯文本 delta，流式推送到 UI' },
  { function: 'renderResponse', file: 'src/ui/ConversationView.tsx', line: 98, description: 'UI 层渲染最终 Markdown 响应' }
]" />

### 3.1 Agentic Loop 详解

Claude Code 的核心执行模式是一个**自主循环**：

```
┌──────────────────────────────────────────────────────┐
│                     Agentic Loop                      │
│                                                       │
│   ┌─────────┐     ┌──────────┐     ┌─────────────┐   │
│   │ 发送请求  │────▶│ 接收响应  │────▶│ 解析Content  │   │
│   │ (含历史)  │     │ (SSE流)  │     │ Block类型   │   │
│   └─────────┘     └──────────┘     └──────┬──────┘   │
│        ▲                                   │          │
│        │                    ┌──────────────┼──────┐   │
│        │                    │              │      │   │
│        │              tool_use        text_delta  │   │
│        │                    │              │      │   │
│        │                    ▼              ▼      │   │
│        │              ┌──────────┐   ┌────────┐  │   │
│        │              │ 执行工具  │   │ 渲染到  │  │   │
│        │              │ 权限校验  │   │ 终端UI │  │   │
│        │              └────┬─────┘   └────┬───┘  │   │
│        │                   │              │      │   │
│        │                   ▼              │      │   │
│        │              ┌──────────┐       │      │   │
│        │              │ 追加结果  │       │      │   │
│        │              │ 到历史   │       │      │   │
│        │              └────┬─────┘       │      │   │
│        │                   │             │      │   │
│        └───────────────────┘        结束循环 │   │
│                                              │   │
│                              ┌───────────────┘   │
│                              ▼                   │
│                        等待用户输入               │
└──────────────────────────────────────────────────────┘
```

单次用户输入可能触发**多轮**工具调用循环。例如用户说"帮我重构这个文件"，模型可能依次调用：`Read`（读取文件）→ `Grep`（查找引用）→ `Edit`（修改文件）→ `Bash`（运行测试）→ 输出总结文本。整个过程无需用户介入。

### 3.2 消息历史结构

一次完整交互后的消息历史可能如下：

```json
[
  { "role": "user", "content": "帮我修复 login.ts 中的类型错误" },
  { "role": "assistant", "content": [
    { "type": "text", "text": "让我先查看文件内容..." },
    { "type": "tool_use", "id": "tu_1", "name": "Read", "input": {"file_path": "src/login.ts"} }
  ]},
  { "role": "user", "content": [
    { "type": "tool_result", "tool_use_id": "tu_1", "content": "export function login(user: string) {...}" }
  ]},
  { "role": "assistant", "content": [
    { "type": "tool_use", "id": "tu_2", "name": "Edit", "input": {
      "file_path": "src/login.ts",
      "old_string": "function login(user: string)",
      "new_string": "function login(user: LoginParams)"
    }}
  ]},
  { "role": "user", "content": [
    { "type": "tool_result", "tool_use_id": "tu_2", "content": "文件已更新" }
  ]},
  { "role": "assistant", "content": [
    { "type": "text", "text": "已将参数类型从 `string` 修改为 `LoginParams`..." }
  ]}
]
```

**关键设计**：`tool_result` 的 role 是 `user`，这符合 Anthropic Messages API 的协议要求——工具结果作为"用户"提供的信息喂回给模型。

---

## 四、关键设计模式

### 4.1 策略模式—— 工具注册与路由

工具系统采用策略模式，每个工具是一个独立策略：

```typescript
// 工具注册表
const toolRegistry = new Map<string, Tool>();

function registerTool(tool: Tool) {
  toolRegistry.set(tool.name, tool);
}

// 执行时通过名称查找策略
async function executeTool(name: string, input: unknown): Promise<ToolResult> {
  const tool = toolRegistry.get(name);
  if (!tool) throw new UnknownToolError(name);
  return tool.execute(input, toolContext);
}
```

**优势**：新增工具只需实现 `Tool` 接口并注册，无需修改调度逻辑。符合开闭原则。

### 4.2 中间件模式—— API 请求管道

API 通信层使用中间件链处理请求/响应：

<CallChain :chain="[
  { function: 'sendRequest', file: 'src/api/StreamHandler.ts', line: 89, description: '发起请求入口' },
  { function: 'tokenBudgetMiddleware', file: 'src/api/middleware/tokenBudget.ts', line: 12, description: '检查 Token 预算，必要时触发上下文压缩' },
  { function: 'retryMiddleware', file: 'src/api/middleware/retry.ts', line: 23, description: '包装请求，添加指数退避重试逻辑' },
  { function: 'loggingMiddleware', file: 'src/api/middleware/logging.ts', line: 8, description: '记录请求耗时和 Token 用量' },
  { function: 'fetch', file: 'src/api/StreamHandler.ts', line: 156, description: '实际发起 HTTP 请求' }
]" />

### 4.3 观察者模式—— UI 状态同步

终端 UI 通过事件系统与核心引擎解耦：

```typescript
// 事件总线
type EventMap = {
  'message:delta': { text: string };
  'tool:start': { toolName: string; input: unknown };
  'tool:complete': { toolName: string; output: string };
  'tool:permission': { toolName: string; resolve: (allowed: boolean) => void };
  'conversation:end': { reason: 'complete' | 'error' | 'cancelled' };
};

class EventBus {
  private handlers = new Map<string, Set<Function>>();
  
  on<K extends keyof EventMap>(event: K, handler: (data: EventMap[K]) => void) { /* ... */ }
  emit<K extends keyof EventMap>(event: K, data: EventMap[K]) { /* ... */ }
}
```

UI 组件订阅事件，核心引擎发布事件，二者无直接依赖。

### 4.4 状态机模式—— 会话生命周期

会话管理使用显式状态机：

```
         ┌──────────┐
    ┌───▶│  IDLE    │◀───┐
    │    │ (等待输入) │    │
    │    └────┬─────┘    │
    │         │ 用户输入   │
    │         ▼          │
    │    ┌──────────┐    │
    │    │ STREAMING│    │
    │    │ (接收流)  │────┘ 文本结束(无工具调用)
    │    └────┬─────┘
    │         │ 遇到 tool_use
    │         ▼
    │    ┌──────────┐
    │    │ EXECUTING│
    │    │ (工具执行) │
    │    └────┬─────┘
    │         │ 工具完成
    │         │
    │         ▼
    │    ┌──────────┐
    │    │ PENDING  │───▶ 需要权限确认 → AWAITING_PERMISSION
    │    │ (结果待发) │
    │    └──────────┘
    │
    └──── 循环回 STREAMING（自动续写）
```

### 4.5 装饰器模式—— 工具能力增强

工具在注册时被层层包装：

```typescript
function wrapWithPermissionCheck(tool: Tool, guard: PermissionGuard): Tool {
  return {
    ...tool,
    async execute(params, ctx) {
      await guard.check(tool.name, params);
      return tool.execute(params, ctx);
    }
  };
}

function wrapWithLogging(tool: Tool): Tool {
  return {
    ...tool,
    async execute(params, ctx) {
      const start = Date.now();
      const result = await tool.execute(params, ctx);
      logger.info(`Tool ${tool.name} took ${Date.now() - start}ms`);
      return result;
    }
  };
}

// 装饰链
const finalTool = wrapWithLogging(wrapWithPermissionCheck(rawTool, guard));
```

### 4.6 上下文压缩策略

当对话 Token 接近模型上限时，<CodeLink filePath="src/conversation/ContextCompactor.ts" :line="1" /> 执行压缩：

1. **识别可压缩消息**：已被工具结果"消化"的中间消息
2. **生成摘要**：调用模型对早期对话生成结构化摘要
3. **替换历史**：用单条摘要消息替换多轮原始消息
4. **保留关键信息**：系统提示、最近 N 轮完整消息不被压缩

---

## 五、入口点 main.tsx 深度剖析

<CodeLink filePath="src/main.tsx" :line="1" /> 是理解整个系统启动序列的关键。

### 5.1 启动序列

<CallChain :chain="[
  { function: 'main()', file: 'src/main.tsx', line: 1, description: 'Node.js 进程入口，异步主函数' },
  { function: 'parseArgs()', file: 'src/cli.ts', line: 15, description: '解析命令行参数，生成 CLIConfig' },
  { function: 'loadConfig()', file: 'src/config/config.ts', line: 30, description: '加载分层配置：默认值 → 全局配置 → 项目配置 → CLI参数覆盖' },
  { function: 'initializeAPI()', file: 'src/api/client.ts', line: 22, description: '初始化 Anthropic SDK 客户端，设置 API Key 和 Base URL' },
  { function: 'createToolRegistry()', file: 'src/tools/registry.ts', line: 18, description: '实例化并注册所有内置工具，应用装饰器链' },
  { function: 'createConversationManager()', file: 'src/conversation/ConversationManager.ts', line: 45, description: '创建会话管理器，注入工具注册表和权限守护' },
  { function: 'render()', file: 'src/main.tsx', line: 67, description: '使用 Ink 的 render() 将 React 组件树挂载到终端' },
  { function: 'App', file: 'src/ui/App.tsx', line: 12, description: 'React 根组件初始化，订阅事件总线，进入主循环' }
]" />

### 5.2 配置合并优先级

```
最低优先级 ────────────────────────────────────── 最高优先级

内置默认值 → ~/.claude/config.json → .claude/settings.json → CLI --flags → 环境变量
                                                    │
                                            (最终生效的配置)
```

### 5.3 优雅退出处理

<CodeLink filePath="src/main.tsx" :line="89" /> 中的退出处理逻辑：

```typescript
process.on('SIGINT', async () => {
  // 1. 取消进行中的 API 请求（AbortController）
  // 2. 取消进行中的工具执行（子进程 kill）
  // 3. 将当前对话状态持久化（如果启用了 --resume）
  // 4. 清理终端状态（恢复光标、清除替代屏幕缓冲区）
  // 5. 调用 Ink 的 unmount() 清理 React 树
  process.exit(130); // 128 + SIGINT(2)
});
```

### 5.4 错误边界策略

main.tsx 中设置了多层错误防护：

| 层级 | 错误类型 | 处理方式 |
|------|----------|----------|
| 进程级 | 未捕获异常 | 打印友好错误信息 + 退出码 1 |
| API 层 | 网络超时/5xx | 指数退避重试，最多 3 次 |
| 工具层 | 文件不存在/权限拒绝 | 返回结构化错误，模型可自行修正 |
| UI 层 | 渲染异常 | React Error Boundary 捕获，显示降级 UI |
| 权限层 | 用户拒绝 | 返回 `permission_denied` 结果给模型 |

---

## 六、架构设计哲学总结

1. **工具即接口**：所有环境交互通过统一 Tool 接口，可扩展、可审计、可拦截
2. **流式优先**：从 API 响应到终端渲染，全程流式处理，零感知延迟
3. **权限最小化**：默认拒绝危险操作，用户显式授权后才执行
4. **状态与渲染分离**：核心引擎是纯逻辑层，UI 是纯展示层，通过事件总线连接
5. **自主循环**：Agentic Loop 使模型能自主完成多步骤任务，用户只在必要时介入
6. **上下文经济**：通过压缩策略最大化利用有限的上下文窗口

这种架构使得 Claude Code 既能作为简单的问答终端，又能作为自主完成复杂编码任务的 Agent，而底层的模块化设计确保了两种模式下的代码路径是一致的。
