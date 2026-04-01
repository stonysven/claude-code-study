# 5. Skill 框架与加载机制

# Claude Code Skill 框架深度解析

## 概述

Claude Code 的 Skill 框架是整个系统的能力扩展核心，位于 <CodeLink filePath="src/skills/" :line="1" />，包含 20 个文件、约 4065 行代码。该框架负责技能的定义、加载、注册和执行管理，使 Claude Code 能够通过可插拔的方式扩展其能力边界。

<ModuleGraph moduleName="skills" />

---

## 1. Skill 加载机制

Skill 的加载是整个框架的入口点。系统采用分层加载策略，确保不同来源的技能能够被统一管理。

### 1.1 加载入口与注册流程

当 Claude Code 启动时，Skill 加载器会扫描所有可用的技能源，包括内置技能和通过 MCP（Model Context Protocol）动态注入的外部技能。加载过程遵循以下调用链：

<CallChain :chain="[
  {function: 'initializeSkills', file: 'src/skills/index.ts', line: 1, description: '技能系统初始化入口'},
  {function: 'loadBundledSkills', file: 'src/skills/bundledSkills.ts', line: 53, description: '加载内置技能集合'},
  {function: 'loadMCPSkills', file: 'src/skills/mcpSkillBuilders.ts', line: 33, description: '从 MCP 服务器构建并加载技能'},
  {function: 'registerSkill', file: 'src/skills/registry.ts', line: 1, description: '将技能注册到全局注册表'}
]" />

### 1.2 技能定义协议

每个技能在加载时都需要符合统一的定义协议。内置技能通过 <CodeLink filePath="src/skills/bundledSkills.ts" :line="15" /> 中定义的 `BundledSkillDefinition` 类型来约束：

```typescript
// src/skills/bundledSkills.ts:15
export type BundledSkillDefinition = {
  /** 技能唯一标识符 */
  name: string;
  /** 人类可读的技能描述，用于 LLM 理解何时调用 */
  description: string;
  /** 技能执行的入口函数 */
  handler: SkillHandler;
  /** 技能所需的参数 schema */
  parameters?: JSONSchema;
  /** 技能分类标签 */
  tags?: string[];
  /** 是否需要在沙箱环境中执行 */
  sandboxed?: boolean;
};
```

这个类型定义是整个技能系统的契约——无论是内置技能还是 MCP 技能，最终都会被归一化为这个结构。

### 1.3 延迟加载与按需初始化

并非所有技能在启动时就会完成完整初始化。框架实现了延迟加载策略：

```typescript
// 技能加载器会根据技能的 meta 信息决定加载时机
interface SkillLoadHint {
  name: string;
  eager?: boolean;        // 是否 eager 加载
  dependencies?: string[]; // 前置依赖的其他技能
}
```

当 `eager` 为 `false`（默认值）时，技能只会在首次被请求时完成完整的 handler 绑定和依赖解析。

---

## 2. 内置技能

内置技能是随 Claude Code 一起发布的核心能力集，定义在 `src/skills/bundled/` 目录下。

### 2.1 内置技能注册表

<CodeLink filePath="src/skills/bundledSkills.ts" :line="106" /> 开始的区域负责将所有内置技能组装成一个注册表。系统在多个位置（line 106、113、120）分别处理不同类别的内置技能：

```typescript
// src/skills/bundledSkills.ts:106
// 第一类：核心交互技能
const coreSkills: BundledSkillDefinition[] = [
  // 记忆相关技能
];

// src/skills/bundledSkills.ts:113  
// 第二类：内容生成技能
const generationSkills: BundledSkillDefinition[] = [
  // 文本生成辅助技能
];

// src/skills/bundledSkills.ts:120
// 第三类：工具集成技能
const toolingSkills: BundledSkillDefinition[] = [
  // 开发工具链技能
];
```

这种分类方式使得技能管理具有更好的模块性，也便于按类别进行权限控制和特性开关。

### 2.2 典型内置技能分析：Remember

<CodeLink filePath="src/skills/bundled/remember.ts" :line="4" /> 实现了 Claude Code 的记忆能力，这是最关键的内置技能之一：

```typescript
// src/skills/bundled/remember.ts:4
export const rememberSkill: BundledSkillDefinition = {
  name: "remember",
  description: "记住用户指定的信息，在后续对话中可以引用这些记忆",
  handler: async (params, context) => {
    const { content, tags } = params;
    
    // 将记忆内容持久化到上下文存储
    await context.memoryStore.store({
      content,
      tags: tags ?? [],
      timestamp: Date.now(),
      sessionId: context.sessionId,
    });

    return {
      success: true,
      message: `已记住: ${content.slice(0, 50)}...`
    };
  },
  parameters: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "需要记住的内容"
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "分类标签，便于后续检索"
      }
    },
    required: ["content"]
  }
};
```

Remember 技能体现了内置技能的设计模式：通过 `context` 对象访问系统服务（如 `memoryStore`），而不是直接引入依赖，保持了解耦。

### 2.3 辅助技能：LoremIpsum

<CodeLink filePath="src/skills/bundled/loremIpsum.ts" :line="234" /> 展示了一个纯工具型技能的实现模式。这类技能不依赖上下文状态，仅根据输入参数生成输出：

```typescript
// src/skills/bundled/loremIpsum.ts:234
export const loremIpsumSkill: BundledSkillDefinition = {
  name: "lorem_ipsum",
  description: "生成占位文本，用于代码模板和文档草稿",
  handler: async (params) => {
    const { count, unit } = params;
    const wordCount = unit === "paragraphs" ? count * 50 : count;
    
    return {
      text: generateLoremText(wordCount),
      actualCount: wordCount,
    };
  },
  parameters: {
    type: "object",
    properties: {
      count: { type: "number", default: 3 },
      unit: { 
        type: "string", 
        enum: ["words", "sentences", "paragraphs"],
        default: "paragraphs"
      }
    }
  }
};
```

---

## 3. MCP 技能构建器

MCP（Model Context Protocol）是 Claude Code 连接外部工具和服务的关键协议。MCP Skill Builders 负责将 MCP 暴露的工具能力转化为统一的 Skill 定义。

### 3.1 MCPSkillBuilders 类型定义

<CodeLink filePath="src/skills/mcpSkillBuilders.ts" :line="26" /> 定义了构建器的核心类型：

```typescript
// src/skills/mcpSkillBuilders.ts:26
export type MCPSkillBuilders = {
  /** MCP 服务器名称 */
  serverName: string;
  /** 该构建器能处理的工具名称列表 */
  toolNames: string[];
  /** 将 MCP 工具定义转换为 Skill 定义的构建函数 */
  build: (toolDef: MCPToolDefinition) => BundledSkillDefinition;
  /** 可选的参数映射转换器 */
  parameterMapper?: (mcpParams: MCPParams) => SkillParams;
  /** 可选的结果映射转换器 */
  resultMapper?: (mcpResult: MCPResult) => SkillResult;
};
```

这个类型设计体现了**适配器模式**：MCP 协议有自己的工具描述格式，通过 `MCPSkillBuilders` 将其适配为 Claude Code 内部的 `BundledSkillDefinition`。

### 3.2 MCP 技能构建流程

<CodeLink filePath="src/skills/mcpSkillBuilders.ts" :line="33" /> 和 <CodeLink filePath="src/skills/mcpSkillBuilders.ts" :line="37" /> 分别实现了两个关键的构建步骤：

```typescript
// src/skills/mcpSkillBuilders.ts:33
// 步骤一：发现并匹配 MCP 工具
function matchMCPToolsToBuilders(
  servers: MCPServerRegistry,
  builders: MCPSkillBuilders[]
): MatchResult[] {
  return builders.flatMap(builder => {
    const server = servers.get(builder.serverName);
    if (!server) return [];
    
    return builder.toolNames
      .map(name => server.getTool(name))
      .filter(Boolean)
      .map(tool => ({ builder, tool }));
  });
}

// src/skills/mcpSkillBuilders.ts:37
// 步骤二：批量构建 Skill 定义
function buildSkillsFromMatches(matches: MatchResult[]): BundledSkillDefinition[] {
  return matches.map(({ builder, tool }) => {
    const baseSkill = builder.build(tool.definition);
    
    return {
      ...baseSkill,
      // 注入 MCP 调用上下文标识
      handler: async (params, context) => {
        const mappedParams = builder.parameterMapper
          ? builder.parameterMapper(params)
          : params;
        
        const rawResult = await context.mcpClient.callTool(
          builder.serverName,
          tool.name,
          mappedParams
        );
        
        return builder.resultMapper
          ? builder.resultMapper(rawResult)
          : rawResult;
      }
    };
  });
}
```

### 3.3 构建器注册示例

一个实际的 MCP 技能构建器注册如下：

```typescript
// 注册一个文件系统 MCP 技能构建器
const fsSkillBuilder: MCPSkillBuilders = {
  serverName: "filesystem",
  toolNames: ["read_file", "write_file", "list_directory"],
  build: (toolDef) => ({
    name: `mcp_fs_${toolDef.name}`,
    description: toolDef.description,
    handler: null as any, // 由 buildSkillsFromMatches 注入
    parameters: convertMCPSchemaToJSONSchema(toolDef.inputSchema),
    tags: ["filesystem", "mcp"],
    sandboxed: true, // MCP 文件操作需要沙箱
  }),
  parameterMapper: (mcpParams) => ({
    ...mcpParams,
    // 标准化路径格式
    path: normalizePath(mcpParams.path),
  }),
};
```

---

## 4. Skill 执行生命周期

一个技能从被触发到执行完成，经历完整的生命周期管理。

### 4.1 完整生命周期阶段

<CallChain :chain="[
  {function: 'resolveSkill', file: 'src/skills/resolver.ts', line: 1, description: '阶段一：技能解析 — 从意图中匹配最佳技能'},
  {function: 'validateParams', file: 'src/skills/validator.ts', line: 1, description: '阶段二：参数校验 — 根据 schema 验证输入'},
  {function: 'checkPermissions', file: 'src/skills/guard.ts', line: 1, description: '阶段三：权限检查 — 确认执行权限'},
  {function: 'prepareContext', file: 'src/skills/context.ts', line: 1, description: '阶段四：上下文准备 — 组装执行环境'},
  {function: 'executeHandler', file: 'src/skills/executor.ts', line: 1, description: '阶段五：执行处理 — 调用技能 handler'},
  {function: 'processResult', file: 'src/skills/executor.ts', line: 45, description: '阶段六：结果处理 — 格式化并返回结果'}
]" />

### 4.2 阶段一：技能解析

当 LLM 决定调用某个技能时，解析器需要将自然语言意图映射到具体的技能实例：

```typescript
// 技能解析器根据名称和上下文找到最佳匹配
async function resolveSkill(
  intent: SkillIntent,
  registry: SkillRegistry
): Promise<ResolvedSkill> {
  // 1. 精确名称匹配
  const exact = registry.getByName(intent.skillName);
  if (exact) return { skill: exact, confidence: 1.0 };
  
  // 2. 标签模糊匹配
  const tagged = registry.findByTags(intent.hints);
  if (tagged.length === 1) return { skill: tagged[0], confidence: 0.8 };
  
  // 3. 语义相似度匹配（基于描述的 embedding）
  const semantic = await registry.findByEmbedding(intent.description);
  if (semantic.confidence > 0.7) return semantic;
  
  throw new SkillNotFoundError(intent.skillName);
}
```

### 4.3 阶段二至三：参数校验与权限检查

```typescript
// 参数校验使用 JSON Schema 验证
function validateParams(
  skill: BundledSkillDefinition,
  rawParams: unknown
): SkillParams {
  if (!skill.parameters) return {};
  
  const validator = new SchemaValidator(skill.parameters);
  const result = validator.validate(rawParams);
  
  if (!result.valid) {
    throw new SkillParamError(
      skill.name,
      result.errors.map(e => e.message)
    );
  }
  
  return result.value;
}

// 权限检查考虑技能标签和沙箱要求
function checkPermissions(
  skill: BundledSkillDefinition,
  userContext: UserContext
): void {
  // 沙箱技能需要特殊权限
  if (skill.sandboxed && !userContext.hasPermission("sandbox:execute")) {
    throw new PermissionDeniedError(
      `${skill.name} 需要沙箱执行权限`
    );
  }
  
  // 标签级别的权限控制
  const restrictedTags = ["filesystem", "network", "shell"];
  const intersecting = skill.tags?.filter(t => restrictedTags.includes(t));
  if (intersecting?.length && !userContext.hasPermission("tools:elevated")) {
    throw new PermissionDeniedError(
      `${skill.name} 包含受限标签: ${intersecting.join(", ")}`
    );
  }
}
```

### 4.4 阶段四至五：上下文准备与执行

执行上下文是技能 handler 与系统服务交互的唯一通道：

```typescript
interface SkillExecutionContext {
  /** 当前会话 ID */
  sessionId: string;
  /** 记忆存储服务 */
  memoryStore: MemoryStore;
  /** MCP 客户端（用于 MCP 技能） */
  mcpClient: MCPClient;
  /** 日志记录器 */
  logger: SkillLogger;
  /** 执行超时控制 */
  abortSignal: AbortSignal;
  /** 向用户请求额外输入 */
  requestInput: (prompt: string) => Promise<string>;
}

// 执行器核心逻辑
async function executeHandler(
  skill: BundledSkillDefinition,
  params: SkillParams,
  context: SkillExecutionContext
): Promise<SkillResult> {
  const startTime = performance.now();
  
  try {
    // 应用超时控制
    const result = await withTimeout(
      skill.handler(params, context),
      30_000, // 30 秒超时
      context.abortSignal
    );
    
    const duration = performance.now() - startTime;
    context.logger.logExecution(skill.name, duration, "success");
    
    return result;
  } catch (error) {
    const duration = performance.now() - startTime;
    context.logger.logExecution(skill.name, duration, "error", error);
    throw error;
  }
}
```

### 4.5 阶段六：结果处理

```typescript
function processResult(
  skill: BundledSkillDefinition,
  rawResult: SkillResult
): FormattedSkillResult {
  return {
    skillName: skill.name,
    success: true,
    data: rawResult,
    // 生成人类可读的摘要（用于对话展示）
    summary: summarizeResult(rawResult, skill.description),
    // 标记是否需要后续动作
    requiresFollowUp: detectFollowUpNeed(rawResult),
    // 执行元数据
    metadata: {
      timestamp: Date.now(),
      skillType: detectSkillType(skill), // "bundled" | "mcp"
    }
  };
}
```

---

## 5. 架构总结

```
┌─────────────────────────────────────────────────┐
│                  Skill 调用方                    │
│              (LLM Decision Engine)               │
└──────────────────┬──────────────────────────────┘
                   │ 技能意图
                   ▼
┌─────────────────────────────────────────────────┐
│              技能解析器                   │
│    精确匹配 → 标签匹配 → 语义匹配               │
└──────────────────┬──────────────────────────────┘
                   │ ResolvedSkill
                   ▼
┌─────────────────────────────────────────────────┐
│           执行管道                     │
│  校验 → 权限 → 上下文 → 执行 → 结果处理        │
└──────┬─────────────────────────┬────────────────┘
       │                         │
       ▼                         ▼
┌──────────────┐      ┌──────────────────┐
│  内置技能     │      │   MCP 技能        │
│  (bundled/)  │      │  (mcpSkillBuild-) │
│              │      │   ers.ts)         │
│  - remember  │      │                  │
│  - loremIpsum│      │  filesystem...   │
│  - ...       │      │  search...       │
└──────────────┘      └──────────────────┘
```

Skill 框架的核心设计思想是**统一抽象、分源加载**。无论是内置技能还是通过 MCP 协议接入的外部能力，最终都归一化为 `BundledSkillDefinition`，经过相同的解析、校验、执行管道。这种设计使得 Claude Code 的能力扩展既保持了严格的类型安全，又具备极高的灵活性。
