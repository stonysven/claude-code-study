# 7. API 通信层

# Claude Code API 通信层深度指南

Claude Code 的 API 通信层是一个精心设计的多层架构，负责处理与 Claude API 的交互、远程会话管理、成本追踪以及流量控制。本文将深入剖析这一核心子系统的设计与实现。

---

## 一、整体架构概览

Claude Code 的通信层分为三个主要子系统：

```
┌─────────────────────────────────────────────┐
│              Claude Code Client             │
├─────────────┬───────────────┬───────────────┤
│  API 集成层  │  远程会话管理层 │   成本与限流层  │
│ (services/) │  (remote/)    │  (services/)  │
├─────────────┴───────────────┴───────────────┤
│            WebSocket / HTTP 传输层            │
└─────────────────────────────────────────────┘
```

<ModuleGraph moduleName="services" />

---

## 二、Claude API 集成

### 2.1 消息转换适配器

API 集成的核心挑战在于将 Claude Code 内部的消息格式转换为 Anthropic API 所需的标准格式。这一工作由 `sdkMessageAdapter` 完成。

在 <CodeLink filePath="src/remote/sdkMessageAdapter.ts" :line="145" /> 中定义了 `ConvertedMessage` 类型，作为内部消息与 API 请求之间的桥梁：

```typescript
// src/remote/sdkMessageAdapter.ts:145
type ConvertedMessage = {
  role: "user" | "assistant";
  content: ContentBlock[];
  // 转换后的元数据
  metadata?: {
    sessionId?: string;
    toolResults?: ToolResultMap;
  };
};
```

适配器处理的关键转换包括：

| 内部格式 | API 格式 | 说明 |
|---------|---------|------|
| ToolCall 请求 | `tool_use` block | 工具调用参数序列化 |
| ToolResult 响应 | `tool_result` block | 执行结果的标准化封装 |
| SystemPrompt | `system` 参数 | 系统提示的注入点 |
| 多轮对话 | messages 数组 | 上下文窗口管理 |

### 2.2 流式响应处理

Claude API 使用 Server-Sent Events (SSE) 进行流式响应，Claude Code 通过事件分发器将原始流转换为结构化的事件：

```typescript
// 伪代码示例 - 基于 services/ 层实现
async function* streamClaudeResponse(
  request: ClaudeRequest
): AsyncGenerator<StreamEvent> {
  const response = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: request.model,
      max_tokens: request.maxTokens,
      stream: true,
      messages: request.messages,
    }),
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const event = JSON.parse(line.slice(6));
        yield normalizeStreamEvent(event);
      }
    }
  }
}
```

---

## 三、远程会话管理

远程会话管理是 Claude Code 支持分布式协作的核心能力，实现在 <CodeLink filePath="src/remote/" /> 模块中。

### 3.1 会话管理器核心类

<CodeLink filePath="src/remote/RemoteSessionManager.ts" :line="95" /> 中的 `RemoteSessionManager` 类是整个远程会话系统的中枢：

```typescript
// src/remote/RemoteSessionManager.ts:95
class RemoteSessionManager {
  private config: RemoteSessionConfig;
  private callbacks: RemoteSessionCallbacks;
  private activeSessions: Map<string, RemoteSession>;
  private permissionBridge: RemotePermissionBridge;

  constructor(config: RemoteSessionConfig, callbacks: RemoteSessionCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
    this.activeSessions = new Map();
    this.permissionBridge = new RemotePermissionBridge(config.permissions);
  }

  async createSession(params: SessionParams): Promise<RemoteSession> {
    const sessionId = generateSessionId();
    const session = new RemoteSession({
      id: sessionId,
      ...params,
      createdAt: Date.now(),
    });

    this.activeSessions.set(sessionId, session);
    await this.establishWebSocket(sessionId);

    return session;
  }
}
```

### 3.2 会话配置结构

<CodeLink filePath="src/remote/RemoteSessionManager.ts" :line="50" /> 定义了 `RemoteSessionConfig` 类型，精细控制会话行为：

```typescript
// src/remote/RemoteSessionManager.ts:50
type RemoteSessionConfig = {
  // 连接配置
  endpoint: string;
  reconnectInterval: number;
  maxReconnectAttempts: number;
  heartbeatTimeout: number;

  // 安全配置
  permissions: PermissionConfig;
  allowedOrigins: string[];

  // 会话生命周期
  idleTimeout: number;
  maxSessionDuration: number;
};
```

### 3.3 WebSocket 通信层

<CodeLink filePath="src/remote/SessionsWebSocket.ts" :line="82" /> 中的 `SessionsWebSocket` 类封装了底层的 WebSocket 通信，处理连接管理、心跳保活和消息路由：

```typescript
// src/remote/SessionsWebSocket.ts:82
class SessionsWebSocket {
  private ws: WebSocket | null = null;
  private callbacks: SessionsWebSocketCallbacks;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts: number = 0;

  constructor(
    private url: string,
    private config: WebSocketConfig,
    callbacks: SessionsWebSocketCallbacks
  ) {
    this.callbacks = callbacks;
  }

  connect(): void {
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.startHeartbeat();
      this.callbacks.onConnected?.();
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.routeMessage(message);
    };

    this.ws.onclose = (event) => {
      this.stopHeartbeat();
      if (!event.wasClean) {
        this.scheduleReconnect();
      }
    };
  }

  private routeMessage(message: IncomingMessage): void {
    switch (message.type) {
      case "session_update":
        this.callbacks.onSessionUpdate?.(message.payload);
        break;
      case "permission_request":
        this.callbacks.onPermissionRequest?.(message.payload);
        break;
      case "tool_execution":
        this.callbacks.onToolExecution?.(message.payload);
        break;
      case "heartbeat_ack":
        // 重置心跳超时计数
        break;
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.send({ type: "heartbeat", timestamp: Date.now() });
    }, this.config.heartbeatInterval);
  }
}
```

### 3.4 会话回调机制

<CodeLink filePath="src/remote/SessionsWebSocket.ts" :line="57" /> 定义了 `SessionsWebSocketCallbacks`，提供事件驱动的扩展点：

```typescript
// src/remote/SessionsWebSocket.ts:57
type SessionsWebSocketCallbacks = {
  onConnected?: () => void;
  onDisconnected?: (code: number, reason: string) => void;
  onSessionUpdate?: (update: SessionUpdate) => void;
  onPermissionRequest?: (request: PermissionRequest) => void;
  onToolExecution?: (execution: ToolExecutionEvent) => void;
  onError?: (error: SessionError) => void;
};
```

<CodeLink filePath="src/remote/RemoteSessionManager.ts" :line="64" /> 中的 `RemoteSessionCallbacks` 则提供更高层级的会话事件：

```typescript
// src/remote/RemoteSessionManager.ts:64
type RemoteSessionCallbacks = {
  onSessionCreated: (session: RemoteSession) => void;
  onSessionDestroyed: (sessionId: string) => void;
  onMessageReceived: (sessionId: string, message: ConvertedMessage) => void;
  onPermissionResponse: (response: RemotePermissionResponse) => void;
};
```

### 3.5 远程权限桥接

远程会话中的工具调用需要经过权限校验。<CodeLink filePath="src/remote/remotePermissionBridge.ts" :line="12" /> 实现了权限请求的转发与响应收集：

```typescript
// src/remote/remotePermissionBridge.ts:12
// 权限桥接器将远程的工具调用权限请求
// 转换为本地权限检查流程

// src/remote/RemoteSessionManager.ts:40
type RemotePermissionResponse = {
  requestId: string;
  approved: boolean;
  reason?: string;
  conditions?: PermissionCondition[];
};
```

<CallChain :chain="[
  {function: 'handleToolCall', file: 'src/remote/RemoteSessionManager.ts', line: '329', description: '处理远程工具调用'},
  {function: 'requestPermission', file: 'src/remote/remotePermissionBridge.ts', line: '12', description: '发起权限请求'},
  {function: 'evaluatePermission', file: 'src/services/remoteManagedSettings/securityCheck.tsx', line: '22', description: '执行安全策略评估'},
  {function: 'sendPermissionResponse', file: 'src/remote/remotePermissionBridge.ts', line: '53', description: '返回权限决策结果'}
]" />

---

## 四、成本追踪

### 4.1 Token 计量体系

Claude Code 实现了细粒度的 Token 使用追踪，区分不同类型的 Token 消耗：

```typescript
// 基于 services/ 层实现的成本追踪
interface TokenUsage {
  // 输入 Token
  inputTokens: number;
  // 输出 Token
  outputTokens: number;
  // 缓存命中的 Token（成本更低）
  cacheReadTokens: number;
  cacheCreationTokens: number;

  // 按工具细分的消耗
  toolUsage: Map<string, {
    inputTokens: number;
    outputTokens: number;
    callCount: number;
  }>;
}
```

### 4.2 成本计算引擎

不同模型和 Token 类型的定价不同，成本计算器将原始 Token 数转换为实际费用：

```typescript
// 基于 services/ 层实现
class CostCalculator {
  private pricing: ModelPricing = {
    "claude-sonnet-4-20250514": {
      inputPerMToken: 3.0,       // $3/MTok
      outputPerMToken: 15.0,      // $15/MTok
      cacheReadPerMToken: 0.3,    // $0.3/MTok
      cacheWritePerMToken: 3.75,  // $3.75/MTok
    },
    "claude-opus-4-20250514": {
      inputPerMToken: 15.0,
      outputPerMToken: 75.0,
      cacheReadPerMToken: 1.5,
      cacheWritePerMToken: 18.75,
    },
  };

  calculate(usage: TokenUsage, model: string): CostBreakdown {
    const prices = this.pricing[model];
    return {
      inputCost: (usage.inputTokens / 1_000_000) * prices.inputPerMToken,
      outputCost: (usage.outputTokens / 1_000_000) * prices.outputPerMToken,
      cacheReadCost: (usage.cacheReadTokens / 1_000_000) * prices.cacheReadPerMToken,
      cacheWriteCost: (usage.cacheCreationTokens / 1_000_000) * prices.cacheWritePerMToken,
      totalCost: 0, // 汇总计算
    };
  }
}
```

### 4.3 会话级成本聚合

成本追踪贯穿整个会话生命周期，支持实时查询和历史统计：

```typescript
// 会话成本聚合器
class SessionCostTracker {
  private costs: Map<string, CumulativeCost> = new Map();

  recordApiCall(sessionId: string, usage: TokenUsage, model: string): void {
    const current = this.costs.get(sessionId) || this.createEmptyCost();
    const callCost = this.calculator.calculate(usage, model);

    current.totalInputTokens += usage.inputTokens;
    current.totalOutputTokens += usage.outputTokens;
    current.totalCost += callCost.totalCost;
    current.apiCallCount += 1;

    this.costs.set(sessionId, current);
  }

  getSessionCost(sessionId: string): CostReport {
    const cost = this.costs.get(sessionId);
    return {
      ...cost,
      estimatedRemaining: this.estimateRemaining(cost),
      budgetUtilization: cost.totalCost / cost.budgetLimit,
    };
  }
}
```

---

## 五、速率限制与重试逻辑

### 5.1 速率限制器

Claude API 有严格的速率限制，Claude Code 实现了多层限流策略：

```typescript
// 基于 services/ 层实现的速率限制器
class RateLimiter {
  // 令牌桶算法实现
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private refillRate: number; // tokens per second

  constructor(config: RateLimitConfig) {
    this.maxTokens = config.maxRequests;
    this.tokens = config.maxRequests;
    this.refillRate = config.requestsPerSecond;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // 计算需要等待的时间
    const waitTime = (1 - this.tokens) / this.refillRate * 1000;
    await sleep(waitTime);
    this.refill();
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(
      this.maxTokens,
      this.tokens + elapsed * this.refillRate
    );
    this.lastRefill = now;
  }
}
```

### 5.2 自适应重试策略

当遇到限流（429）或服务端错误（5xx）时，Claude Code 采用指数退避 + 抖动的重试策略：

```typescript
// 基于 services/ 层实现的重试逻辑
class RetryHandler {
  private attempt: number = 0;
  private maxRetries: number;
  private baseDelay: number;
  private maxDelay: number;

  async executeWithRetry<T>(
    fn: () => Promise<T>,
    context: string
  ): Promise<T> {
    while (true) {
      try {
        return await fn();
      } catch (error) {
        if (!this.shouldRetry(error)) {
          throw error;
        }

        this.attempt++;
        if (this.attempt > this.maxRetries) {
          throw new MaxRetriesExceededError(context, this.attempt);
        }

        const delay = this.calculateDelay(error);
        logger.warn(
          `请求失败，${delay}ms 后进行第 ${this.attempt} 次重试`,
          { context, error: error.message }
        );
        await sleep(delay);
      }
    }
  }

  private calculateDelay(error: ApiError): number {
    // 基础指数退避
    const exponentialDelay = this.baseDelay * Math.pow(2, this.attempt - 1);

    // 如果是 429 错误，使用服务端返回的 retry-after
    if (error.status === 429 && error.retryAfterMs) {
      return Math.max(error.retryAfterMs, exponentialDelay);
    }

    // 添加随机抖动防止惊群效应
    const jitter = Math.random() * this.baseDelay;
    return Math.min(exponentialDelay + jitter, this.maxDelay);
  }

  private shouldRetry(error: ApiError): boolean {
    // 429 Too Many Requests - 重试
    if (error.status === 429) return true;
    // 5xx 服务端错误 - 重试
    if (error.status >= 500 && error.status < 600) return true;
    // 网络错误 - 重试
    if (error.isNetworkError) return true;
    // 4xx 客户端错误（非429）- 不重试
    return false;
  }
}
```

### 5.3 限流响应处理

当 API 返回 429 状态码时，Claude Code 解析响应头获取精确的限流信息：

```typescript
// 解析 429 响应头
interface RateLimitInfo {
  requestsLimit: number;
  requestsRemaining: number;
  resetAt: Date;
  retryAfterMs: number;
  tokensLimit: number;
  tokensRemaining: number;
}

function parseRateLimitHeaders(headers: Headers): RateLimitInfo {
  return {
    requestsLimit: parseInt(headers.get("x-ratelimit-limit-requests") || "0"),
    requestsRemaining: parseInt(headers.get("x-ratelimit-remaining-requests") || "0"),
    tokensLimit: parseInt(headers.get("x-ratelimit-limit-tokens") || "0"),
    tokensRemaining: parseInt(headers.get("x-ratelimit-remaining-tokens") || "0"),
    resetAt: new Date(headers.get("x-ratelimit-reset") || ""),
    retryAfterMs: parseInt(headers.get("retry-after") || "0") * 1000,
  };
}
```

### 5.4 完整的 API 调用链路

将以上组件串联，形成完整的请求处理管线：

<CallChain :chain="[
  {function: 'sendRequest', file: 'src/services/apiClient.ts', line: '1', description: '发起 API 请求入口'},
  {function: 'acquire', file: 'src/services/rateLimiter.ts', line: '1', description: '获取速率令牌'},
  {function: 'executeWithRetry', file: 'src/services/retryHandler.ts', line: '1', description: '带重试的请求执行'},
  {function: 'streamClaudeResponse', file: 'src/services/streamHandler.ts', line: '1', description: '处理流式响应'},
  {function: 'recordApiCall', file: 'src/services/costTracker.ts', line: '1', description: '记录 Token 消耗与成本'},
  {function: 'routeMessage', file: 'src/remote/SessionsWebSocket.ts', line: '82', description: '路由响应到对应会话'}
]" />

---

## 六、安全检查集成

远程会话中的操作需要经过安全策略检查。<CodeLink filePath="src/services/remoteManagedSettings/securityCheck.tsx" :line="12" /> 定义了安全检查结果类型：

```typescript
// src/services/remoteManagedSettings/securityCheck.tsx:12
type SecurityCheckResult = {
  allowed: boolean;
  violations?: SecurityViolation[];
  riskLevel: "low" | "medium" | "high" | "critical";
  remediationActions?: string[];
};
```

<CodeLink filePath="src/services/remoteManagedSettings/securityCheck.tsx" :line="22" /> 中的异步检查函数执行实际的安全策略评估：

```typescript
// src/services/remoteManagedSettings/securityCheck.tsx:22
// 该函数对远程操作进行多维度安全评估：
// 1. 路径遍历检查
// 2. 敏感文件访问控制
// 3. 命令注入检测
// 4. 网络访问范围验证
```

安全检查结果会被缓存在同步缓存中，<CodeLink filePath="src/services/remoteManagedSettings/syncCache.ts" :line="27" /> 和 <CodeLink filePath="src/services/remoteManagedSettings/syncCacheState.ts" :line="37" /> 管理缓存的生命周期和状态同步：

```typescript
// src/services/remoteManagedSettings/syncCacheState.ts:37
// 缓存状态管理支持：
// - 增量同步
// - 冲突解决
// - 过期策略
// src/services/remoteManagedSettings/syncCacheState.ts:41
// src/services/remoteManagedSettings/syncCacheState.ts:46
// src/services/remoteManagedSettings/syncCacheState.ts:51
// src/services/remoteManagedSettings/syncCacheState.ts:70
// 上述行号对应不同的状态转换逻辑
```

---

## 七、架构设计要点总结

### 设计模式应用

| 模式 | 应用场景 | 实现位置 |
|------|---------|---------|
| 适配器模式 | 消息格式转换 | `sdkMessageAdapter.ts` |
| 观察者模式 | WebSocket 事件分发 | `SessionsWebSocketCallbacks` |
| 策略模式 | 重试策略选择 | `RetryHandler` |
| 桥接模式 | 权限请求转发 | `remotePermissionBridge.ts` |
| 令牌桶算法 | 速率限制 | `RateLimiter` |

### 关键设计决策

1. **流式优先**：所有 Claude API 调用均使用流式响应，降低首字延迟（TTFT）
2. **分层限流**：客户端令牌桶 + 服务端 429 响应双重保障
3. **成本可视化**：按会话、按工具维度的细粒度成本追踪
4. **安全兜底**：远程操作强制经过安全检查，结果可缓存

### 性能考量

- **缓存读取优化**：通过 `cacheReadTokens` 大幅降低长上下文的输入成本
- **连接复用**：WebSocket 长连接避免频繁握手开销
- **异步非阻塞**：所有 I/O 操作均为异步，不阻塞主线程
- **增量同步**：远程设置缓存支持增量更新，减少带宽消耗
