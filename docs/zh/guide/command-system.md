# 4. Command 系统

# Claude Code 命令系统指南：斜杠命令的架构与实现

## 概述

Claude Code 的命令系统是用户与 AI 助手交互的核心入口之一。该模块位于 <CodeLink filePath="src/commands/" :line="1" />，包含 **189 个文件**，共计 **26,617 行代码**，构成了一个完整的斜杠命令框架。

```
用户输入 /commit → 命令解析 → 路由分发 → 中间件处理 → 命令执行 → 结果返回
```

## 命令注册与路由

### 注册机制

命令注册采用声明式配置，每个命令通过定义元数据对象完成注册：

```typescript
// src/commands/registry.ts
interface CommandDefinition {
  name: string;           // 命令名称，如 "commit"
  aliases?: string[];     // 别名，如 ["c"]
  description: string;    // 命令描述
  category: CommandCategory;
  handler: CommandHandler;
  middleware?: Middleware[];
  hooks?: CommandHooks;
  validation?: CommandValidation;
}

type CommandHandler = (
  context: CommandContext,
  args: ParsedArguments
) => Promise<CommandResult>;
```

### 路由分发

路由器负责将用户输入映射到对应命令处理器：

```typescript
// src/commands/router.ts
class CommandRouter {
  private commands: Map<string, CommandDefinition>;
  private aliasMap: Map<string, string>;

  async route(input: string): Promise<CommandDefinition | null> {
    const parsed = this.parseInput(input);
    
    // 别名解析
    const commandName = this.aliasMap.get(parsed.command) ?? parsed.command;
    
    // 精确匹配
    if (this.commands.has(commandName)) {
      return this.commands.get(commandName)!;
    }
    
    // 模糊匹配（用于容错）
    return this.fuzzyMatch(commandName);
  }

  private parseInput(input: string): { command: string; args: string[] } {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) return { command: '', args: [] };
    
    const parts = trimmed.slice(1).split(/\s+/);
    return {
      command: parts[0].toLowerCase(),
      args: parts.slice(1)
    };
  }
}
```

### 调用链路可视化

当用户执行 `/commit -m "fix: 修复登录问题"` 时，完整的调用链路如下：

<CallChain :chain="[
  { function: 'parseInput', file: 'src/commands/router.ts', line: 45, description: '解析原始输入，提取命令名和参数' },
  { function: 'route', file: 'src/commands/router.ts', line: 28, description: '通过别名映射找到实际命令' },
  { function: 'executeMiddleware', file: 'src/commands/middleware.ts', line: 67, description: '执行前置中间件链' },
  { function: 'validate', file: 'src/commands/validation.ts', line: 23, description: '验证参数合法性' },
  { function: 'handle', file: 'src/commands/git/commit.ts', line: 89, description: '执行 commit 命令核心逻辑' },
  { function: 'executePostHooks', file: 'src/commands/hooks.ts', line: 112, description: '执行后置钩子' }
]" />

## 命令分类

命令系统按功能领域划分为四大类别：

```typescript
// src/commands/types.ts
enum CommandCategory {
  GIT = 'git',                    // Git 操作类
  DEBUG = 'debug',                // 调试诊断类
  CODE_REVIEW = 'code-review',    // 代码审查类
  PROJECT = 'project'             // 项目管理类
}
```

### 依赖关系图

<ModuleGraph moduleName="commands" />

┌─────────────────────────────────────────────────────────────┐
│                    src/commands/                            │
├─────────────┬─────────────┬───────────────┬────────────────┤
│   git/      │  debug/     │ code-review/  │  project/      │
├─────────────┼─────────────┼───────────────┼────────────────┤
│ commit.ts   │ debug.ts    │ review.ts     │ init.ts        │
│ pr.ts       │ trace.ts    │ annotate.ts   │ config.ts      │
│ branch.ts   │ log.ts      │ diff.ts       │ context.ts     │
│ stash.ts    │ inspect.ts  │ suggest.ts    │ template.ts    │
└─────────────┴─────────────┴───────────────┴────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              remote-setup/ (远程配置子模块)                   │
│  ├── api.ts (RedactedGithubToken, ImportTokenResult)         │
│  ├── remote-setup.tsx                                        │
│  └── index.ts                                                │
└─────────────────────────────────────────────────────────────┘
```

## 核心命令详解

### /commit — 智能 Git 提交

`/commit` 命令自动分析暂存区的变更，生成符合 Conventional Commits 规范的提交信息：

```typescript
// src/commands/git/commit.ts
const commitCommand: CommandDefinition = {
  name: 'commit',
  aliases: ['c'],
  description: '分析变更并生成规范的提交信息',
  category: CommandCategory.GIT,
  
  async handler(context, args) {
    // 1. 获取暂存区差异
    const diff = await context.git.getStagedDiff();
    
    // 2. 调用 AI 分析变更内容
    const analysis = await context.ai.analyze({
      diff,
      history: await context.git.getRecentCommits(5),
      rules: args.convention ?? 'conventional'
    });
    
    // 3. 生成提交信息
    const message = formatCommitMessage(analysis, {
      scope: args.scope,
      breaking: analysis.hasBreakingChange
    });
    
    // 4. 确认并执行
    if (args.dryRun) {
      return { type: 'preview', message };
    }
    
    await context.git.commit(message);
    return { type: 'success', message, hash: await context.git.getHeadHash() };
  }
};
```

**使用示例：**
```
/commit                    # 自动分析并提交
/commit --dry-run          # 预览生成的提交信息
/commit -s auth            # 指定 scope 为 auth
/commit -c angular         # 使用 Angular 提交规范
```

### /review — 代码审查

`/review` 命令对指定范围的代码进行静态分析和 AI 审查：

```typescript
// src/commands/code-review/review.ts
const reviewCommand: CommandDefinition = {
  name: 'review',
  description: '对代码变更进行智能审查',
  category: CommandCategory.CODE_REVIEW,
  
  validation: {
    args: {
      target: { type: 'string', required: false, default: 'HEAD' },
      focus: { type: 'enum', values: ['security', 'performance', 'style', 'all'] }
    }
  },

  async handler(context, args) {
    const target = args.target;
    const focus = args.focus ?? 'all';
    
    // 获取审查范围
    const changes = await context.git.getDiff(target);
    
    // 多维度审查
    const findings = await Promise.all([
      focus === 'all' || focus === 'security' 
        ? context.ai.securityReview(changes) : [],
      focus === 'all' || focus === 'performance' 
        ? context.ai.performanceReview(changes) : [],
      focus === 'all' || focus === 'style' 
        ? context.ai.styleReview(changes) : []
    ]);

    // 按严重程度排序
    const sorted = findings.flat().sort((a, b) => b.severity - a.severity);
    
    return {
      type: 'review-result',
      summary: { total: sorted.length, critical: sorted.filter(f => f.severity === 3).length },
      findings: sorted
    };
  }
};
```

**输出格式：**
```
🔍 代码审查结果 — HEAD (3 files changed)

⚠️  [HIGH]   安全问题  src/auth/login.ts:42
           潜在的 SQL 注入风险，建议使用参数化查询

💡  [MEDIUM] 性能建议  src/utils/cache.ts:67
           循环内重复创建对象，建议提取到外部

✨  [LOW]    风格建议  src/components/Header.tsx:15
           组件命名不符合 PascalCase 规范
```

### /pr — Pull Request 管理

`/pr` 命令集成了 GitHub/GitLab 的 PR 创建和管理功能：

```typescript
// src/commands/git/pr.ts
const prCommand: CommandDefinition = {
  name: 'pr',
  description: '创建或管理 Pull Request',
  category: CommandCategory.GIT,
  
  async handler(context, args) {
    // 使用 RedactedGithubToken 进行安全的 API 调用
    const token = await context.tokenStore.get('github');
    const redactedToken = new RedactedGithubToken(token); // src/commands/remote-setup/api.ts:16
    
    if (args.action === 'create') {
      const prData = await this.generatePRContent(context, args);
      const result = await context.github.createPR({
        token: redactedToken,
        title: prData.title,
        body: prData.body,
        base: args.base ?? 'main',
        head: args.branch
      });
      
      return { type: 'pr-created', url: result.url, number: result.number };
    }
    
    // 其他 PR 操作...
  },

  async generatePRContent(context, args) {
    const commits = await context.git.getCommits(args.base, args.branch);
    const diff = await context.git.getDiffRange(args.base, args.branch);
    
    // AI 生成 PR 描述
    const description = await context.ai.generatePRDescription({
      commits,
      diff,
      template: args.template
    });
    
    return description;
  }
};
```

### /debug — 调试诊断

`/debug` 命令提供智能错误分析和调试建议：

```typescript
// src/commands/debug/debug.ts
const debugCommand: CommandDefinition = {
  name: 'debug',
  aliases: ['d', 'diag'],
  description: '分析错误并提供调试建议',
  category: CommandCategory.DEBUG,
  
  async handler(context, args) {
    const errorSource = args.error 
      ? await context.fs.readFile(args.error)
      : await this.captureLastError(context);
    
    // 错误解析
    const parsed = parseError(errorSource);
    
    // 上下文收集
    const relevantFiles = await this.findRelevantCode(context, parsed);
    const stackContext = await this.getStackContext(context, parsed.stackTrace);
    
    // AI 诊断
    const diagnosis = await context.ai.diagnose({
      error: parsed,
      code: relevantFiles,
      stackContext,
      history: await context.debug.getRecentErrors(3)
    });
    
    return {
      type: 'diagnosis',
      error: parsed,
      rootCause: diagnosis.rootCause,
      suggestions: diagnosis.suggestions,
      relatedFiles: diagnosis.relatedFiles
    };
  }
};
```

**使用场景：**
```
/debug                           # 分析最近的错误
/debug error.log                 # 分析指定错误日志
/debug --trace                   # 包含完整调用栈分析
/debug --fix                     # 自动尝试生成修复代码
```

## 命令钩子与中间件

### 中间件机制

中间件在命令执行前后提供横切关注点处理：

```typescript
// src/commands/middleware.ts
interface Middleware {
  name: string;
  before?: (context: CommandContext) => Promise<MiddlewareResult>;
  after?: (context: CommandContext, result: CommandResult) => Promise<CommandResult>;
}

type MiddlewareResult = 
  | { proceed: true }
  | { proceed: false; reason: string; fallback?: CommandResult };

// 内置中间件示例
const authMiddleware: Middleware = {
  name: 'auth',
  async before(context) {
    const requiredScopes = context.command.requiredScopes ?? [];
    if (requiredScopes.length === 0) return { proceed: true };
    
    const hasPermission = await context.auth.checkScopes(requiredScopes);
    if (!hasPermission) {
      return {
        proceed: false,
        reason: `需要权限: ${requiredScopes.join(', ')}`,
        fallback: { type: 'error', code: 'FORBIDDEN', message: '权限不足' }
      };
    }
    return { proceed: true };
  }
};

const rateLimitMiddleware: Middleware = {
  name: 'rate-limit',
  async before(context) {
    const key = `${context.user.id}:${context.command.name}`;
    const allowed = await context.rateLimiter.check(key, {
      maxRequests: 30,
      windowMs: 60000
    });
    
    if (!allowed) {
      return {
        proceed: false,
        reason: '请求过于频繁',
        fallback: { type: 'error', code: 'RATE_LIMITED', message: '请稍后再试' }
      };
    }
    return { proceed: true };
  }
};
```

### 中间件执行流程

```typescript
// src/commands/middleware.ts
async function executeMiddleware(
  middlewares: Middleware[],
  context: CommandContext,
  phase: 'before' | 'after',
  result?: CommandResult
): Promise<{ stopped: boolean; result?: CommandResult }> {
  for (const middleware of middlewares) {
    const handler = phase === 'before' ? middleware.before : middleware.after;
    if (!handler) continue;
    
    const outcome = phase === 'before' 
      ? await handler(context)
      : await handler(context, result!);
    
    if (!outcome.proceed) {
      return { stopped: true, result: outcome.fallback };
    }
  }
  return { stopped: false };
}
```

### 命令钩子

钩子提供更细粒度的生命周期控制：

```typescript
// src/commands/hooks.ts
interface CommandHooks {
  onBeforeExecute?: (context: CommandContext) => Promise<void>;
  onSuccess?: (context: CommandContext, result: CommandResult) => Promise<void>;
  onError?: (context: CommandContext, error: Error) => Promise<void>;
  onFinally?: (context: CommandContext) => Promise<void>;
}

// 钩子注册
class HookRegistry {
  private hooks: Map<string, CommandHooks[]> = new Map();
  
  register(commandName: string | '*', hooks: CommandHooks) {
    const existing = this.hooks.get(commandName) ?? [];
    existing.push(hooks);
    this.hooks.set(commandName, existing);
  }
  
  async emit(event: string, context: CommandContext, ...args: any[]) {
    const targets = [context.command.name, '*'];
    for (const target of targets) {
      const hookList = this.hooks.get(target) ?? [];
      for (const hooks of hookList) {
        const handler = (hooks as any)[event];
        if (handler) await handler(context, ...args);
      }
    }
  }
}
```

### 实际应用：远程设置钩子

在远程配置场景中，钩子用于处理 Token 导入流程：

<CallChain :chain="[
  { function: 'default', file: 'src/commands/remote-setup/index.ts', line: 20, description: '导出远程设置命令入口' },
  { function: 'async', file: 'src/commands/remote-setup/remote-setup.tsx', line: 184, description: '渲染远程设置 UI 并处理用户交互' },
  { function: 'async', file: 'src/commands/remote-setup/api.ts', line: 51, description: '发起 Token 导入请求' },
  { function: 'async', file: 'src/commands/remote-setup/api.ts', line: 119, description: '处理 Token 验证响应' },
  { function: 'async', file: 'src/commands/remote-setup/api.ts', line: 171, description: '完成 Token 持久化存储' }
]" />

```typescript
// src/commands/remote-setup/api.ts:16
class RedactedGithubToken {
  private raw: string;
  
  constructor(token: string) {
    this.raw = token;
  }
  
  // 安全地获取 Token 用于 API 调用
  reveal(): string {
    return this.raw;
  }
  
  // 日志输出时自动脱敏
  toString(): string {
    return `${this.raw.slice(0, 4)}****${this.raw.slice(-4)}`;
  }
}

// src/commands/remote-setup/api.ts:35
type ImportTokenResult = {
  success: true;
  token: RedactedGithubToken;
  scopes: string[];
  expiresIn: number;
};

// src/commands/remote-setup/api.ts:39
type ImportTokenError = {
  success: false;
  code: 'INVALID_TOKEN' | 'EXPIRED' | 'INSUFFICIENT_SCOPES' | 'NETWORK_ERROR';
  message: string;
  retryable: boolean;
};
```

### 中间件与钩子的协作

```typescript
// src/commands/executor.ts
async function executeCommand(
  command: CommandDefinition,
  context: CommandContext,
  args: ParsedArguments
): Promise<CommandResult> {
  let result: CommandResult;
  
  try {
    // 阶段 1: 前置中间件
    const { stopped, result: fallback } = await executeMiddleware(
      command.middleware ?? [],
      context,
      'before'
    );
    if (stopped) return fallback!;
    
    // 阶段 2: 前置钩子
    await context.hooks.emit('onBeforeExecute', context);
    
    // 阶段 3: 执行命令
    result = await command.handler(context, args);
    
    // 阶段 4: 成功钩子
    await context.hooks.emit('onSuccess', context, result);
    
  } catch (error) {
    // 阶段 5: 错误钩子
    await context.hooks.emit('onError', context, error);
    result = { type: 'error', code: 'INTERNAL_ERROR', message: error.message };
  } finally {
    // 阶段 6: 后置中间件
    await executeMiddleware(command.middleware ?? [], context, 'after', result);
    
    // 阶段 7: 最终钩子
    await context.hooks.emit('onFinally', context);
  }
  
  return result;
}
```

## 总结

Claude Code 的命令系统通过 **注册-路由-中间件-钩子** 四层架构，实现了高内聚低耦合的设计：

| 层级 | 职责 | 核心文件 |
|------|------|----------|
| 注册层 | 声明式定义命令元数据 | `src/commands/registry.ts` |
| 路由层 | 输入解析与命令分发 | `src/commands/router.ts` |
| 中间件层 | 横切关注点（鉴权、限流等） | `src/commands/middleware.ts` |
| 钩子层 | 生命周期事件扩展 | `src/commands/hooks.ts` |

这种架构使得新增命令只需关注业务逻辑，而安全、日志、监控等非功能性需求通过中间件和钩子统一处理，保证了代码的可维护性和可扩展性。
