# 8. MCP 协议集成

# Claude Code 的 MCP (Model Context Protocol) 集成指南

## 概述

Model Context Protocol (MCP) 是 Claude Code 中实现外部工具和资源集成的核心协议。通过 MCP，Claude Code 能够与外部服务、本地工具和远程资源进行标准化交互。整个 MCP 子系统位于 <CodeLink filePath="src/services" :line="1" /> 服务层中，是该平台最重要的扩展机制之一。

<ModuleGraph moduleName="mcp" />

---

## 一、MCP 服务器连接管理

### 1.1 连接生命周期

MCP 服务器的连接管理遵循严格的生命周期模型，包括初始化、握手、活跃、暂停和断开五个阶段。

```typescript
// src/services/mcp/connectionManager.ts
export enum ConnectionState {
  DISCONNECTED = "disconnected",
  CONNECTING = "connecting",
  HANDSHAKING = "handshaking",
  CONNECTED = "connected",
  SUSPENDED = "suspended",
  ERROR = "error",
}

export class MCPConnectionManager {
  private connections: Map<string, MCPConnection> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  async connect(serverId: string, config: MCPServerConfig): Promise<void> {
    const existing = this.connections.get(serverId);
    if (existing?.state === ConnectionState.CONNECTED) {
      return; // 已连接，跳过
    }

    const connection = new MCPConnection(serverId, config);
    this.connections.set(serverId, connection);

    try {
      connection.transition(ConnectionState.CONNECTING);
      
      // 建立 transport 层连接
      const transport = this.createTransport(config);
      await transport.connect();
      
      connection.transition(ConnectionState.HANDSHAKING);
      await this.performHandshake(connection, transport);
      
      connection.transition(ConnectionState.CONNECTED);
      connection.attachTransport(transport);
    } catch (err) {
      connection.transition(ConnectionState.ERROR);
      this.scheduleReconnect(serverId, config);
      throw err;
    }
  }
}
```

### 1.2 重连机制

当连接意外断开时，系统采用指数退避策略进行重连：

```typescript
// src/services/mcp/connectionManager.ts:87
private scheduleReconnect(serverId: string, config: MCPServerConfig): void {
  const attempt = this.reconnectAttempts.get(serverId) ?? 0;
  const maxAttempts = config.reconnect?.maxAttempts ?? 5;
  
  if (attempt >= maxAttempts) {
    this.emit("reconnectFailed", { serverId });
    return;
  }

  const baseDelay = config.reconnect?.baseDelay ?? 1000;
  const maxDelay = config.reconnect?.maxDelay ?? 30000;
  const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

  const timer = setTimeout(() => {
    this.reconnectAttempts.set(serverId, attempt + 1);
    this.connect(serverId, config).catch(() => {});
  }, delay);

  this.reconnectTimers.set(serverId, timer);
}
```

### 1.3 连接状态流转

<CallChain :chain="[
  {function: 'connect', file: 'src/services/mcp/connectionManager.ts', line: 24, description: '发起连接请求'},
  {function: 'createTransport', file: 'src/services/mcp/connectionManager.ts', line: 38, description: '创建传输层 (stdio/SSE/WebSocket)'},
  {function: 'performHandshake', file: 'src/services/mcp/connectionManager.ts', line: 42, description: '执行 MCP 协议握手'},
  {function: 'transition', file: 'src/services/mcp/connection.ts', line: 15, description: '状态机转换至 CONNECTED'}
]" />

---

## 二、工具与资源的 MCP 暴露

### 2.1 工具注册表

MCP 工具通过注册表模式进行统一管理，每个工具都包含严格的 schema 定义：

```typescript
// src/services/mcp/toolRegistry.ts
export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  handler: ToolHandler;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  rateLimit?: {
    maxCallsPerMinute: number;
  };
}

export class MCPToolRegistry {
  private tools: Map<string, MCPToolDefinition> = new Map();
  private serverToolMap: Map<string, Set<string>> = new Map();

  registerTool(serverId: string, tool: MCPToolDefinition): void {
    // 验证工具名称合法性
    if (!this.isValidToolName(tool.name)) {
      throw new MCPSchemaError(
        `Invalid tool name: ${tool.name}. Must match pattern:^[a-zA-Z][a-zA-Z0-9_-]*$`
      );
    }

    // 检查跨服务器名称冲突
    for (const [sid, toolNames] of this.serverToolMap) {
      if (sid !== serverId && toolNames.has(tool.name)) {
        throw new MCPConflictError(
          `Tool "${tool.name}" already registered by server "${sid}"`
        );
      }
    }

    // 验证 JSON Schema
    this.validateInputSchema(tool.inputSchema);

    this.tools.set(tool.name, tool);
    
    const serverTools = this.serverToolMap.get(serverId) ?? new Set();
    serverTools.add(tool.name);
    this.serverToolMap.set(serverId, serverTools);
  }
}
```

### 2.2 资源暴露机制

资源（Resource）是 MCP 中与工具并列的核心概念，代表可读取的数据源：

```typescript
// src/services/mcp/resourceManager.ts
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  annotations?: {
    audience?: string[];
    priority?: number;
  };
}

export interface MCPResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export class MCPResourceManager {
  private resources: Map<string, MCPResource> = new Map();
  private templates: Map<string, MCPResourceTemplate> = new Map();

  async readResource(
    serverId: string,
    uri: string,
    options?: { acceptedEncodings?: string[] }
  ): Promise<MCPResourceContent> {
    const resource = this.resources.get(uri);
    
    if (!resource) {
      // 尝试匹配资源模板
      const matched = this.matchTemplate(uri);
      if (!matched) {
        throw new MCPResourceNotFound(`Resource not found: ${uri}`);
      }
      return matched.handler(uri);
    }

    // 检查服务器归属
    const serverResources = this.serverResourceMap.get(serverId);
    if (!serverResources?.has(uri)) {
      throw new MCPPermissionError(
        `Server "${serverId}" does not own resource "${uri}"`
      );
    }

    return this.fetchResourceContent(resource, options);
  }

  private matchTemplate(uri: string): MatchedTemplate | null {
    for (const [id, template] of this.templates) {
      const pattern = this.templateToRegex(template.uriTemplate);
      const match = uri.match(pattern);
      if (match) {
        return {
          template,
          params: match.groups ?? {},
          handler: this.templateHandlers.get(id)!,
        };
      }
    }
    return null;
  }
}
```

### 2.3 工具调用执行链

<CallChain :chain="[
  {function: 'callTool', file: 'src/services/mcp/toolExecutor.ts', line: 18, description: '接收工具调用请求'},
  {function: 'resolveTool', file: 'src/services/mcp/toolRegistry.ts', line: 95, description: '解析工具定义与所属服务器'},
  {function: 'validateInput', file: 'src/services/mcp/toolRegistry.ts', line: 112, description: '根据 JSON Schema 校验输入参数'},
  {function: 'checkRateLimit', file: 'src/services/mcp/rateLimiter.ts', line: 30, description: '执行速率限制检查'},
  {function: 'sendToolCall', file: 'src/services/mcp/connection.ts', line: 78, description: '通过传输层发送至 MCP 服务器'},
  {function: 'parseResult', file: 'src/services/mcp/toolExecutor.ts', line: 55, description: '解析并标准化返回结果'}
]" />

---

## 三、MCP 认证流程

### 3.1 认证策略接口

Claude Code 的 MCP 认证采用策略模式，支持多种认证方式：

```typescript
// src/services/mcp/auth/strategies.ts
export interface MCPAuthStrategy {
  readonly type: string;
  authenticate(serverConfig: MCPServerConfig): Promise<AuthResult>;
  refreshToken?(token: string): Promise<AuthResult>;
  invalidate?(token: string): Promise<void>;
}

export interface AuthResult {
  token: string;
  expiresAt?: number;
  metadata?: Record<string, string>;
}

// OAuth 2.0 策略实现
export class OAuthStrategy implements MCPAuthStrategy {
  readonly type = "oauth2";
  
  constructor(
    private config: OAuthConfig,
    private tokenStore: TokenStore
  ) {}

  async authenticate(serverConfig: MCPServerConfig): Promise<AuthResult> {
    // 首先尝试从存储中恢复 token
    const stored = await this.tokenStore.get(serverConfig.id);
    if (stored && !this.isExpired(stored)) {
      return stored;
    }

    // 发起 OAuth 授权流程
    const authCode = await this.initiateAuthorizationFlow(serverConfig);
    const tokens = await this.exchangeCodeForToken(authCode);
    
    await this.tokenStore.set(serverConfig.id, tokens);
    return tokens;
  }

  private async initiateAuthorizationFlow(
    config: MCPServerConfig
  ): Promise<string> {
    const authUrl = new URL(this.config.authorizationEndpoint);
    authUrl.searchParams.set("client_id", this.config.clientId);
    authUrl.searchParams.set("redirect_uri", this.config.redirectUri);
    authUrl.searchParams.set("scope", this.config.scopes.join(" "));
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", crypto.randomUUID());

    // 通过系统浏览器打开授权页面
    await openBrowser(authUrl.toString());

    // 启动本地回调服务器接收 authorization code
    return await this.waitForCallback(this.config.redirectUri);
  }
}
```

### 3.2 认证管理器

```typescript
// src/services/mcp/auth/authManager.ts
export class MCPAuthManager {
  private strategies: Map<string, MCPAuthStrategy> = new Map();
  private activeSessions: Map<string, AuthSession> = new Map();

  constructor(
    private tokenStore: TokenStore,
    private securityCheck: SecurityCheckFn
  ) {
    this.registerBuiltinStrategies();
  }

  async authenticateConnection(
    serverId: string,
    config: MCPServerConfig
  ): Promise<AuthHeaders> {
    const authConfig = config.auth;
    if (!authConfig) {
      return {};
    }

    // 安全性检查：验证认证配置来源
    const securityResult = await this.securityCheck({
      type: "mcp_auth",
      serverId,
      authType: authConfig.type,
      configPath: config.configPath,
    });

    if (!securityResult.allowed) {
      throw new MCPAuthError(
        `Authentication blocked by security policy: ${securityResult.reason}`
      );
    }

    const strategy = this.strategies.get(authConfig.type);
    if (!strategy) {
      throw new MCPAuthError(
        `Unknown auth strategy: ${authConfig.type}`
      );
    }

    const result = await strategy.authenticate(config);
    
    this.activeSessions.set(serverId, {
      token: result.token,
      expiresAt: result.expiresAt,
      authenticatedAt: Date.now(),
      strategyType: authConfig.type,
    });

    return this.buildAuthHeaders(result, authConfig.type);
  }

  private buildAuthHeaders(
    result: AuthResult,
    strategyType: string
  ): AuthHeaders {
    switch (strategyType) {
      case "oauth2":
        return { Authorization: `Bearer ${result.token}` };
      case "api_key":
        return { "X-API-Key": result.token };
      case "token":
        return { "MCP-Token": result.token };
      default:
        return { Authorization: `Bearer ${result.token}` };
    }
  }
}
```

### 3.3 认证流程完整链路

<CallChain :chain="[
  {function: 'connect', file: 'src/services/mcp/connectionManager.ts', line: 24, description: '发起 MCP 连接'},
  {function: 'authenticateConnection', file: 'src/services/mcp/auth/authManager.ts', line: 28, description: '执行认证流程'},
  {function: 'securityCheck', file: 'src/services/remoteManagedSettings/securityCheck.tsx', line: 22, description: '安全策略校验'},
  {function: 'authenticate', file: 'src/services/mcp/auth/strategies.ts', line: 18, description: '策略具体认证实现'},
  {function: 'buildAuthHeaders', file: 'src/services/mcp/auth/authManager.ts', line: 72, description: '构造认证请求头'},
  {function: 'attachTransport', file: 'src/services/mcp/connection.ts', line: 45, description: '携带认证信息建立传输层'}
]" />

---

## 四、MCP 插件系统

### 4.1 插件定义与发现

Claude Code 的 MCP 插件系统允许通过声明式配置动态加载 MCP 服务器：

```typescript
// src/services/mcp/plugins/pluginDiscovery.ts
export interface MCPPluginManifest {
  name: string;
  version: string;
  description: string;
  server: {
    type: "stdio" | "sse" | "streamable-http";
    command?: string;          // stdio 类型使用
    url?: string;              // sse/http 类型使用
    args?: string[];
    env?: Record<string, string>;
  };
  auth?: AuthConfig;
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
    logging?: boolean;
  };
  permissions?: {
    allowedTools?: string[];
    deniedTools?: string[];
    allowedResources?: string[];
    deniedResources?: string[];
  };
}

export class MCPPluginDiscovery {
  private pluginDirs: string[];

  constructor(private config: ClaudeCodeConfig) {
    this.pluginDirs = [
      path.join(this.config.dataDir, "mcp-plugins"),
      path.join(this.config.configDir, "mcp-plugins"),
    ];
  }

  async discoverPlugins(): Promise<MCPPluginManifest[]> {
    const manifests: MCPPluginManifest[] = [];

    for (const dir of this.pluginDirs) {
      if (!fs.existsSync(dir)) continue;

      const entries = await fs.promises.readdir(dir, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const manifestPath = path.join(dir, entry.name, "manifest.json");
        if (!fs.existsSync(manifestPath)) continue;

        try {
          const raw = await fs.promises.readFile(manifestPath, "utf-8");
          const manifest = JSON.parse(raw);
          const validated = this.validateManifest(manifest);
          manifests.push(validated);
        } catch (err) {
          this.emit("pluginLoadError", {
            pluginName: entry.name,
            error: err,
          });
        }
      }
    }

    return manifests;
  }

  private validateManifest(raw: unknown): MCPPluginManifest {
    const result = MCPPluginManifestSchema.safeParse(raw);
    if (!result.success) {
      throw new MCPPluginError(
        `Invalid manifest: ${result.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(", ")}`
      );
    }
    return result.data;
  }
}
```

### 4.2 插件生命周期管理

```typescript
// src/services/mcp/plugins/pluginManager.ts
export class MCPPluginManager {
  private plugins: Map<string, PluginInstance> = new Map();
  private toolRegistry: MCPToolRegistry;
  private resourceManager: MCPResourceManager;

  async loadPlugin(manifest: MCPPluginManifest): Promise<void> {
    if (this.plugins.has(manifest.name)) {
      throw new MCPPluginError(
        `Plugin "${manifest.name}" is already loaded`
      );
    }

    const instance: PluginInstance = {
      manifest,
      state: "loading",
      serverId: `plugin-${manifest.name}`,
      loadedAt: Date.now(),
    };

    this.plugins.set(manifest.name, instance);

    try {
      // 1. 创建服务器配置
      const serverConfig = this.manifestToServerConfig(manifest);

      // 2. 通过连接管理器建立连接
      await this.connectionManager.connect(
        instance.serverId,
        serverConfig
      );

      // 3. 发现并注册工具
      if (manifest.capabilities?.tools !== false) {
        const tools = await this.discoverTools(instance.serverId);
        for (const tool of tools) {
          // 应用权限过滤
          if (this.isToolAllowed(tool.name, manifest.permissions)) {
            this.toolRegistry.registerTool(instance.serverId, tool);
          }
        }
      }

      // 4. 发现并注册资源
      if (manifest.capabilities?.resources !== false) {
        const resources = await this.discoverResources(instance.serverId);
        for (const resource of resources) {
          if (this.isResourceAllowed(resource.uri, manifest.permissions)) {
            this.resourceManager.registerResource(
              instance.serverId,
              resource
            );
          }
        }
      }

      instance.state = "active";
      this.emit("pluginLoaded", { name: manifest.name });
    } catch (err) {
      instance.state = "error";
      instance.error = err;
      this.emit("pluginError", { name: manifest.name, error: err });
      throw err;
    }
  }

  async unloadPlugin(name: string): Promise<void> {
    const instance = this.plugins.get(name);
    if (!instance) return;

    // 注销所有工具
    this.toolRegistry.unregisterByServer(instance.serverId);
    // 注销所有资源
    this.resourceManager.unregisterByServer(instance.serverId);
    // 断开连接
    await this.connectionManager.disconnect(instance.serverId);

    instance.state = "unloaded";
    this.plugins.delete(name);
    this.emit("pluginUnloaded", { name });
  }
}
```

### 4.3 权限过滤系统

插件权限系统与 Claude Code 的安全管理模块紧密集成：

```typescript
// src/services/mcp/plugins/permissionFilter.ts
export class MCPPermissionFilter {
  constructor(
    private securityCheck: SecurityCheckFn
  ) {}

  isToolAllowed(
    toolName: string,
    permissions?: PluginPermissions,
    globalDenyList?: string[]
  ): boolean {
    // 全局拒绝列表优先
    if (globalDenyList?.some((p) => this.matchPattern(toolName, p))) {
      return false;
    }

    // 插件级拒绝列表
    if (permissions?.deniedTools?.some((p) => this.matchPattern(toolName, p))) {
      return false;
    }

    // 插件级允许列表（若定义，则仅允许列表中的工具）
    if (permissions?.allowedTools) {
      return permissions.allowedTools.some((p) =>
        this.matchPattern(toolName, p)
      );
    }

    // 未定义允许列表时，默认放行
    return true;
  }

  private matchPattern(name: string, pattern: string): boolean {
    if (pattern === "*") return true;
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      return name.startsWith(prefix + "_") || name === prefix;
    }
    return name === pattern;
  }
}
```

### 4.4 插件加载完整链路

<CallChain :chain="[
  {function: 'initializePlugins', file: 'src/services/mcp/plugins/pluginManager.ts', line: 15, description: '插件系统初始化入口'},
  {function: 'discoverPlugins', file: 'src/services/mcp/plugins/pluginDiscovery.ts', line: 28, description: '扫描插件目录发现所有插件'},
  {function: 'validateManifest', file: 'src/services/mcp/plugins/pluginDiscovery.ts', line: 72, description: '校验插件 manifest 合法性'},
  {function: 'loadPlugin', file: 'src/services/mcp/plugins/pluginManager.ts', line: 35, description: '加载单个插件'},
  {function: 'connect', file: 'src/services/mcp/connectionManager.ts', line: 24, description: '建立 MCP 服务器连接'},
  {function: 'discoverTools', file: 'src/services/mcp/plugins/pluginManager.ts', line: 60, description: '发现并注册工具'},
  {function: 'isToolAllowed', file: 'src/services/mcp/plugins/permissionFilter.ts', line: 18, description: '执行权限过滤'}
]" />

---

## 五、安全集成

MCP 子系统与 Claude Code 的安全策略系统深度集成。所有涉及外部连接的操作都会经过安全检查，相关逻辑位于 <CodeLink filePath="src/services/remoteManagedSettings/securityCheck.tsx" :line="12" /> 中定义的 `SecurityCheckResult` 类型。

```typescript
// src/services/mcp/securityIntegration.ts
export async function mcpSecurityGuard(
  action: MCPAction,
  securityCheck: SecurityCheckFn
): Promise<SecurityDecision> {
  const result = await securityCheck({
    type: "mcp_operation",
    action: action.type,
    serverId: action.serverId,
    // 远程管理设置可能覆盖本地配置
    source: action.configSource,
  });

  if (!result.allowed) {
    return {
      allowed: false,
      reason: result.reason,
      remediation: result.reason.includes("managed settings")
        ? "联系管理员调整远程管理策略"
        : "检查本地 MCP 配置",
    };
  }

  return { allowed: true };
}
```

---

## 六、配置示例

一个典型的 MCP 插件 manifest 文件结构：

```json
{
  "name": "github-mcp",
  "version": "1.2.0",
  "description": "GitHub API integration via MCP",
  "server": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "{{env.GITHUB_TOKEN}}"
    }
  },
  "auth": {
    "type": "api_key",
    "envKey": "GITHUB_PERSONAL_ACCESS_TOKEN"
  },
  "capabilities": {
    "tools": true,
    "resources": false,
    "prompts": false
  },
  "permissions": {
    "allowedTools": ["search_*", "read_*"],
    "deniedTools": ["write_*", "delete_*"]
  }
}
```

---

## 总结

Claude Code 的 MCP 集成是一个层次分明的系统：

| 层次 | 职责 | 核心模块 |
|------|------|----------|
| **连接层** | 传输层抽象、连接生命周期、重连策略 | `connectionManager` |
| **协议层** | 工具注册、资源管理、消息序列化 | `toolRegistry`, `resourceManager` |
| **安全层** | 认证策略、权限过滤、安全检查 | `authManager`, `permissionFilter` |
| **插件层** | 发现、加载、卸载、声明式配置 | `pluginManager`, `pluginDiscovery` |

这种分层设计使得每一层都可以独立演进，同时通过清晰的接口契约保持层间协同。安全检查贯穿所有层次，确保外部 MCP 服务器不会突破 Claude Code 的安全边界。
