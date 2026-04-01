# 9. Agent 多代理架构

# Claude Code 多代理架构深度解析

## 架构概览

Claude Code 采用分层多代理架构，通过协调器（Coordinator）统一管理多个专业化代理的协作。整个系统由会话管理层、协调调度层和代理执行层三部分组成。

```
┌─────────────────────────────────────────────────────────────┐
│                      用户对话层                               │
├─────────────────────────────────────────────────────────────┤
│                   Assistant 核心                             │
│              (消息处理 & AI 交互)                             │
├─────────────────────────────────────────────────────────────┤
│                   Coordinator 协调层                         │
│         (代理调度 & 任务分解 & 结果聚合)                       │
├──────────┬──────────┬──────────┬──────────┬─────────────────┤
│ Agent A  │ Agent B  │ Agent C  │ Agent D  │     ...         │
│(文件操作) │(代码分析) │(测试执行) │(搜索查询) │                 │
└──────────┴──────────┴──────────┴──────────┴─────────────────┘
```

---

## 1. 代理定义与加载

### 1.1 代理核心定义

代理在 Claude Code 中被抽象为具备特定能力边界的执行单元。每个代理通过能力描述、工具集和执行策略进行定义。

协调器模块中通过函数式方式定义代理的行为模式，<CodeLink filePath="src/coordinator/coordinatorMode.ts" :line="36" /> 处的函数负责初始化代理的基础配置：

```typescript
// src/coordinator/coordinatorMode.ts:36
// 代理基础结构定义
function initializeAgentConfig(config: AgentConfig): AgentInstance {
  return {
    id: generateAgentId(),
    capabilities: config.capabilities,
    toolSet: config.tools,
    executionPolicy: config.policy,
    state: AgentState.Idle
  };
}
```

### 1.2 会话历史上下文加载

代理执行需要依赖历史上下文。Assistant 模块通过分页机制加载会话历史，确保代理能获取到足够的对话背景：

```typescript
// src/assistant/sessionHistory.ts:7
const HISTORY_PAGE_SIZE = 50;

// src/assistant/sessionHistory.ts:9
type HistoryPage = {
  messages: Message[];
  totalCount: number;
  hasMore: boolean;
};

// src/assistant/sessionHistory.ts:25
type HistoryAuthCtx = {
  sessionId: string;
  userId: string;
  permissions: string[];
};
```

<CodeLink filePath="src/assistant/sessionHistory.ts" :line="7" /> 定义的 `HISTORY_PAGE_SIZE` 控制每次加载的消息批次大小，而 <CodeLink filePath="src/assistant/sessionHistory.ts" :line="25" /> 的 `HistoryAuthCtx` 类型确保代理只能访问授权范围内的历史数据。

### 1.3 代理加载流程

<CallChain :chain="[
  {function: 'loadSessionHistory', file: 'src/assistant/sessionHistory.ts', line: 31, description: '加载会话历史记录'},
  {function: 'initializeAgentConfig', file: 'src/coordinator/coordinatorMode.ts', line: 36, description: '初始化代理配置'},
  {function: 'registerAgent', file: 'src/coordinator/coordinatorMode.ts', line: 49, description: '注册代理到协调器'},
  {function: 'validateCapabilities', file: 'src/coordinator/coordinatorMode.ts', line: 80, description: '验证代理能力边界'}
]" />

---

## 2. 代理调度与协调

### 2.1 协调器核心机制

协调器是整个多代理系统的"大脑"，负责任务分解、代理选择和执行顺序编排。<CodeLink filePath="src/coordinator/coordinatorMode.ts" :line="111" /> 实现了核心的调度决策逻辑：

```typescript
// src/coordinator/coordinatorMode.ts:111
async function dispatchTask(
  task: AgentTask,
  availableAgents: AgentInstance[]
): Promise<DispatchPlan> {
  // 1. 分析任务类型与复杂度
  const taskAnalysis = analyzeTaskComplexity(task);
  
  // 2. 匹配最合适的代理
  const matchedAgents = matchAgentsByCapability(
    taskAnalysis.requiredCapabilities,
    availableAgents
  );
  
  // 3. 生成执行计划
  return buildExecutionPlan(taskAnalysis, matchedAgents);
}
```

### 2.2 代理注册机制

<CodeLink filePath="src/coordinator/coordinatorMode.ts" :line="49" /> 处理代理的动态注册，支持运行时扩展代理池：

```typescript
// src/coordinator/coordinatorMode.ts:49
function registerAgent(
  registry: AgentRegistry,
  agent: AgentInstance
): void {
  // 检查能力冲突
  if (hasCapabilityConflict(registry, agent)) {
    throw new AgentConflictError(
      `Agent ${agent.id} has conflicting capabilities`
    );
  }
  
  // 注册并按优先级排序
  registry.agents.push(agent);
  registry.agents.sort(byPriorityDescending);
  
  // 更新能力索引
  updateCapabilityIndex(registry, agent);
}
```

### 2.3 调度策略

协调器支持多种调度策略：

| 策略类型 | 适用场景 | 说明 |
|---------|---------|------|
| 顺序执行 | 有依赖关系的任务链 | 严格按照依赖图拓扑排序执行 |
| 并行执行 | 独立子任务 | 多代理同时执行，结果汇聚 |
| 条件分支 | 需要决策的任务 | 根据中间结果动态选择后续代理 |
| 回滚重试 | 可恢复的失败场景 | 自动降级或重试策略 |

<ModuleGraph moduleName="coordinator" />

---

## 3. 子代理执行

### 3.1 能力验证阶段

在子代理实际执行前，协调器会进行严格的能力验证。<CodeLink filePath="src/coordinator/coordinatorMode.ts" :line="80" /> 实现了这个关键的安全检查：

```typescript
// src/coordinator/coordinatorMode.ts:80
function validateCapabilities(
  agent: AgentInstance,
  requiredCapabilities: Capability[],
  context: ExecutionContext
): ValidationResult {
  const missing: Capability[] = [];
  const restricted: Capability[] = [];
  
  for (const cap of requiredCapabilities) {
    if (!agent.capabilities.includes(cap)) {
      missing.push(cap);
    } else if (isRestrictedInContext(cap, context)) {
      restricted.push(cap);
    }
  }
  
  return {
    valid: missing.length === 0 && restricted.length === 0,
    missing,
    restricted,
    fallbackAgents: findFallbackAgents(missing)
  };
}
```

### 3.2 子代理执行生命周期

子代理的执行遵循严格的生命周期管理：

```
┌─────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐
│ Queued  │───▶│ Validated│───▶│ Executing │───▶│ Completed│
└─────────┘    └──────────┘    └───────────┘    └──────────┘
                    │               │
                    ▼               ▼
               ┌──────────┐   ┌──────────┐
               │ Rejected │   │ Failed   │
               └──────────┘   └──────────┘
                                     │
                                     ▼
                               ┌──────────┐
                               │ Retrying │
                               └──────────┘
```

### 3.3 历史上下文注入

子代理执行时需要注入相关的历史上下文，这通过 Assistant 模块的历史加载功能实现：

<CallChain :chain="[
  {function: 'fetchHistoryPage', file: 'src/assistant/sessionHistory.ts', line: 73, description: '获取历史分页数据'},
  {function: 'filterRelevantContext', file: 'src/assistant/sessionHistory.ts', line: 81, description: '过滤与当前任务相关的上下文'},
  {function: 'injectContext', file: 'src/coordinator/coordinatorMode.ts', line: 111, description: '将上下文注入子代理执行环境'},
  {function: 'executeSubAgent', file: 'src/coordinator/coordinatorMode.ts', line: 111, description: '执行子代理任务'}
]" />

<CodeLink filePath="src/assistant/sessionHistory.ts" :line="73" /> 和 <CodeLink filePath="src/assistant/sessionHistory.ts" :line="81" /> 提供了历史数据的获取和过滤能力，确保子代理收到精简且相关的上下文。

---

## 4. 代理间通信

### 4.1 通信架构

Claude Code 的代理间通信采用基于消息传递的异步模型，协调器充当消息路由中心：

```
          ┌──────────────┐
          │  Coordinator │
          │  (Message    │
          │   Router)    │
          └──────┬───────┘
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
┌───────┐   ┌───────┐   ┌───────┐
│Agent A│◄─►│Agent B│◄─►│Agent C│
└───────┘   └───────┘   └───────┘
     │           │           │
     └───────────┼───────────┘
                 ▼
         ┌──────────────┐
         │ Shared State │
         │   Store      │
         └──────────────┘
```

### 4.2 消息协议

代理间的通信消息遵循统一协议格式：

```typescript
interface AgentMessage {
  id: string;
  sourceAgentId: string;
  targetAgentId: string | '*';  // '*' 表示广播
  type: 'task-result' | 'context-request' | 'status-update' | 'error';
  payload: unknown;
  timestamp: number;
  correlationId?: string;  // 用于追踪请求链
  ttl: number;             // 消息生存时间
}
```

### 4.3 通信模式详解

#### 直接点对点通信

适用于代理间明确知道对方身份的场景，如文件操作代理向代码分析代理请求语法信息：

```typescript
// Agent A 向 Agent B 发送直接消息
const message: AgentMessage = {
  id: uuid(),
  sourceAgentId: 'file-operator-001',
  targetAgentId: 'code-analyzer-002',
  type: 'context-request',
  payload: {
    filePath: '/src/utils/parser.ts',
    requestType: 'syntax-tree'
  },
  timestamp: Date.now(),
  correlationId: task.correlationId,
  ttl: 30000
};

coordinator.routeMessage(message);
```

#### 广播通信

适用于状态变更通知场景，如测试执行代理广播测试结果：

```typescript
// 测试代理广播结果
const broadcast: AgentMessage = {
  id: uuid(),
  sourceAgentId: 'test-runner-003',
  targetAgentId: '*',  // 广播给所有代理
  type: 'status-update',
  payload: {
    testResults: results,
    passed: 42,
    failed: 3
  },
  timestamp: Date.now(),
  ttl: 10000
};
```

#### 基于共享状态的间接通信

适用于大数据量或需要持久化的场景：

```typescript
// Agent A 写入共享状态
await sharedStateStore.set(
  `agent:${agentA.id}:result:${taskId}`,
  {
    data: largeAnalysisResult,
    metadata: { expiresAt: Date.now() + 3600000 }
  }
);

// Agent B 读取共享状态
const result = await sharedStateStore.get(
  `agent:${agentA.id}:result:${taskId}`
);
```

### 4.4 通信安全与隔离

协调器在消息路由层面实现了严格的安全控制：

```typescript
// 消息路由时的权限检查
function routeMessage(message: AgentMessage): void {
  // 1. 验证消息来源
  if (!isValidAgent(message.sourceAgentId)) {
    logger.warn('Rejected message from unknown agent', message);
    return;
  }
  
  // 2. 检查 TTL
  if (Date.now() - message.timestamp > message.ttl) {
    logger.debug('Dropped expired message', message.id);
    return;
  }
  
  // 3. 验证目标代理权限
  if (message.targetAgentId !== '*') {
    const target = getAgent(message.targetAgentId);
    if (!canReceiveFrom(target, message.sourceAgentId)) {
      logger.warn('Permission denied for message routing', message);
      return;
    }
  }
  
  // 4. 投递消息
  deliverMessage(message);
}
```

---

## 总结

Claude Code 的多代理架构通过清晰的分层设计实现了高效的协作：

1. **Assistant 层**（<CodeLink filePath="src/assistant/sessionHistory.ts" :line="7" />）：负责对话管理和历史上下文维护，为代理提供必要的背景信息

2. **Coordinator 层**（<CodeLink filePath="src/coordinator/coordinatorMode.ts" :line="36" />）：作为系统核心，处理代理注册、能力验证、任务调度和消息路由

3. **Agent 执行层**：各专业化代理在协调器的统一管理下执行具体任务，通过标准化协议进行通信

这种架构的优势在于：
- **松耦合**：代理之间通过消息通信，不直接依赖
- **可扩展**：通过注册机制动态添加新代理
- **安全可控**：能力验证和通信权限检查确保系统安全
- **可观测**：通过 correlationId 实现完整的调用链追踪
