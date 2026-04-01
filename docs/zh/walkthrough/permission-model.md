# 13. 权限校验模型

# Claude Code 权限模型深度解析

## 概述

Claude Code 的权限模型是其安全架构的核心组件，控制着 AI 助手对用户系统资源的访问级别。该模型通过多层检查机制，确保工具调用在安全的边界内执行。本文将从权限模式、核心 Hook、工具检查流程、沙箱边界以及 Plan 模式限制五个维度进行完整剖析。

---

## 一、权限模式（Permission Modes）

Claude Code 提供三种递进的权限模式，每种模式对应不同的自动化程度和风险等级：

### 1. Ask 模式（默认）

最保守的模式。每次工具调用都需要用户明确确认：

```
权限级别: 最低
工具执行: 需逐次确认
适用场景: 首次使用、敏感项目、生产环境
```

当 Claude 请求执行任何文件写入、命令执行等操作时，UI 层会弹出确认对话框，用户必须手动点击"允许"才会继续。

### 2. Auto-Edit 模式

针对文件编辑操作的自动授权模式：

```
权限级别: 中等
工具执行: 文件读写自动放行，命令执行仍需确认
适用场景: 日常开发、可信项目仓库
```

此模式下，`file_edit`、`file_read`、`file_write` 等文件系统工具会被自动放行，但 `bash`、`mcp` 等可能产生副作用的工具仍需确认。

### 3. Full-Auto 模式

最高自动化级别，所有工具调用均自动执行：

```
权限级别: 最高
工具执行: 全部自动放行（受安全边界约束）
适用场景: CI/CD 流水线、沙箱环境、高度信任场景
```

> **关键设计**：即使 Full-Auto 模式下，沙箱安全边界和硬编码的拒绝规则仍然生效，不会被绕过。

### 模式切换的上下文传递

权限模式通过 React Context 注入到整个组件树中。模式状态存储在应用上下文层，与 <CodeLink filePath="src/context/promptOverlayContext.tsx" :line="24" /> 中定义的 `PromptOverlayData` 类型关联，用于在权限确认弹窗中传递当前模式信息。

<CallChain :chain="[
  {function: 'PermissionModeSelector', file: 'src/components/PermissionModeSelector.tsx', line: 15, description: '用户切换权限模式'},
  {function: 'setPermissionMode', file: 'src/context/permissionContext.tsx', line: 42, description: '更新 Context 中的模式状态'},
  {function: 'usePermissionContext', file: 'src/context/permissionContext.tsx', line: 28, description: '子组件消费新的权限模式'}
]" />

---

## 二、useCanUseTool Hook

`useCanUseTool` 是权限判断的核心 Hook，位于 UI 层与权限逻辑的交汇点。

### 函数签名与职责

```typescript
function useCanUseTool(
  toolName: ToolName,
  toolInput: Record<string, unknown>
): { canUse: boolean; reason?: string; requiresConfirmation: boolean }
```

该 Hook 返回三个关键字段：

| 字段 | 类型 | 含义 |
|------|------|------|
| `canUse` | `boolean` | 工具是否被允许使用 |
| `reason` | `string?` | 拒绝原因（仅 canUse=false 时有值） |
| `requiresConfirmation` | `boolean` | 是否需要用户确认（Ask 模式下的文件操作） |

### 内部判断逻辑

Hook 内部按优先级执行三层检查：

```
1. 硬编码拒绝规则（最高优先级，不可覆盖）
   └─ 例如：写入 /etc/ 目录、执行 rm -rf /

2. 沙箱边界检查
   └─ 当前工作目录约束、环境变量白名单

3. 权限模式匹配（最低优先级）
   └─ 根据 toolName + 当前模式 决定是否放行
```

### 与 UI 层的集成

`useCanUseTool` 的调用位置通常在工具渲染组件内部，与 <CodeLink filePath="src/hooks/renderPlaceholder.ts" :line="13" /> 中的占位渲染逻辑协同工作——当 `canUse` 为 `false` 时，工具卡片会渲染为受限占位状态，而非可交互的确认按钮。

<CallChain :chain="[
  {function: 'ToolCard', file: 'src/components/tool/ToolCard.tsx', line: 85, description: '工具卡片组件渲染'},
  {function: 'useCanUseTool', file: 'src/hooks/useCanUseTool.ts', line: 12, description: '执行权限判断'},
  {function: 'checkHardcodedDenyRules', file: 'src/utils/permissionRules.ts', line: 33, description: '检查硬编码拒绝规则'},
  {function: 'checkSandboxBounds', file: 'src/utils/sandbox.ts', line: 78, description: '检查沙箱边界'},
  {function: 'matchPermissionMode', file: 'src/utils/permissionRules.ts', line: 112, description: '匹配权限模式'}
]" />

---

## 三、工具权限检查流程（Tool Permission Checking）

完整的工具权限检查并非仅由 Hook 完成，而是一个从前端到后端的端到端链路。

### 3.1 前端预检（Pre-flight Check）

当 Claude 决定调用某个工具时，前端在将请求发送到后端之前，先执行本地预检：

```typescript
// 伪代码示意
const preflightResult = checkToolPermission(toolName, toolInput, {
  mode: currentPermissionMode,
  cwd: currentWorkingDirectory,
  sandbox: sandboxConfig,
});
```

如果预检失败，请求不会发出，直接在 UI 层显示拒绝信息。

### 3.2 后端二次校验

即使前端预检通过，后端在执行工具前会进行独立的权限校验。这是**防御性编程**的关键设计——前端检查可被绕过，后端校验是最终防线。

<CallChain :chain="[
  {function: 'handleToolUse', file: 'src/server/toolHandler.ts', line: 45, description: '后端接收到工具调用请求'},
  {function: 'validateToolPermission', file: 'src/server/permission/validator.ts', line: 22, description: '后端独立权限校验'},
  {function: 'checkSandboxConstraints', file: 'src/server/permission/sandbox.ts', line: 56, description: '后端沙箱约束检查'},
  {function: 'executeTool', file: 'src/server/tools/executor.ts', line: 89, description: '校验通过后执行工具'}
]" />

### 3.3 权限规则的数据结构

权限规则以结构化方式存储，核心类型定义如下：

```typescript
interface PermissionRule {
  toolName: ToolName;
  mode: PermissionMode;        // 该规则适用的模式
  action: 'allow' | 'deny' | 'confirm';
  pathPattern?: string;         // 文件路径匹配模式（如 "*.ts"）
  commandPattern?: string;      // 命令匹配模式（如 "npm *"）
  priority: number;             // 规则优先级，数值越高越优先
}
```

规则按 `priority` 降序匹配，第一条命中规则决定结果。这确保了细粒度规则可以覆盖粗粒度的模式默认行为。

---

## 四、沙箱与安全边界（Sandbox & Security Boundaries）

沙箱是权限模型中最不可逾越的硬性边界，独立于权限模式运行。

### 4.1 工作目录约束

沙箱的核心约束是**工作目录**。Claude Code 启动时锁定一个根目录，所有文件操作都被限制在该目录树内：

```
允许: /home/user/project/src/index.ts    ✓
允许: /home/user/project/../README.md     ✓ (规范化后仍在目录内)
拒绝: /etc/passwd                         ✗
拒绝: /home/other-user/                   ✗
```

路径规范化在检查前执行，防止 `..` 遍历攻击。

### 4.2 环境变量白名单

在沙箱环境中，只有显式白名单中的环境变量可被工具访问：

```typescript
const SANDBOX_ENV_WHITELIST = [
  'PATH', 'HOME', 'USER', 'SHELL',
  'NODE_ENV', 'npm_config_*',
  // ... 根据配置动态扩展
];
```

### 4.3 命令执行限制

`bash` 工具在沙箱中有额外的命令级限制：

| 限制类型 | 示例 | 说明 |
|----------|------|------|
| 危险命令黑名单 | `rm -rf /`, `mkfs`, `dd` | 永远拒绝，任何模式下不可执行 |
| 网络访问控制 | `curl`, `wget` | 可通过配置允许/拒绝 |
| 安装命令 | `pip install`, `npm i -g` | Auto-Edit 模式下需确认，Full-Auto 下可放行 |
| 后台进程 | `nohup`, `&`, `screen` | 默认拒绝，防止逃逸 |

### 4.4 MCP 工具的沙箱集成

MCP（Model Context Protocol）工具通过外部服务器扩展 Claude 的能力，但同样受沙箱约束。MCP 服务器的文件系统访问会被代理层拦截，确保不超出沙箱目录。

<CallChain :chain="[
  {function: 'callMcpTool', file: 'src/server/mcp/dispatcher.ts', line: 67, description: 'MCP 工具调用入口'},
  {function: 'wrapSandboxProxy', file: 'src/server/mcp/sandboxProxy.ts', line: 23, description: '包装沙箱代理'},
  {function: 'interceptFileSystemAccess', file: 'src/server/mcp/fsInterceptor.ts', line: 45, description: '拦截文件系统访问'},
  {function: 'isPathInSandbox', file: 'src/server/permission/sandbox.ts', line: 89, description: '校验路径是否在沙箱内'}
]" />

---

## 五、Plan 模式限制

Plan 模式是 Claude Code 的一种特殊运行状态，在此模式下权限模型施加最严格的限制。

### 5.1 Plan 模式的定义

Plan 模式下，Claude 只能"观察和规划"，不能"执行和修改"。这通过权限模型的工具白名单机制实现。

### 5.2 工具访问矩阵

| 工具类别 | 正常模式 | Plan 模式 |
|----------|----------|-----------|
| 文件读取（file_read） | ✓ | ✓ |
| 文件写入（file_write） | ✓（受模式约束） | ✗ |
| 文件编辑（file_edit） | ✓（受模式约束） | ✗ |
| Bash 执行 | ✓（受模式约束） | ✗ |
| 目录浏览（list_dir） | ✓ | ✓ |
| 搜索（search） | ✓ | ✓ |
| MCP 工具 | ✓（受约束） | ✗ |

### 5.3 Plan 模式的实现机制

Plan 模式并非通过独立的权限检查分支实现，而是通过**在权限规则链的最前面插入一条高优先级拒绝规则**：

```typescript
// 当进入 Plan 模式时，动态注入规则
if (isPlanMode) {
  permissionRules.unshift({
    toolName: '*',
    mode: '*',
    action: 'deny',
    priority: Infinity,
    exceptionTools: ['file_read', 'list_dir', 'search'],
  });
}
```

由于规则按优先级降序匹配，`Infinity` 优先级确保 Plan 模式规则始终最先命中，只有 `exceptionTools` 列表中的工具能通过。

### 5.4 Plan 模式状态管理

Plan 模式的状态通过 React Context 管理，与权限上下文协同工作。当用户切换到 Plan 模式时，<CodeLink filePath="src/context/promptOverlayContext.tsx" :line="64" /> 中的上下文更新函数会被调用，触发权限规则链的重建。

<CallChain :chain="[
  {function: 'togglePlanMode', file: 'src/components/PlanModeToggle.tsx', line: 18, description: '用户切换 Plan 模式'},
  {function: 'updateOverlayState', file: 'src/context/promptOverlayContext.tsx', line: 64, description: '更新覆盖层上下文'},
  {function: 'rebuildPermissionRules', file: 'src/utils/permissionRules.ts', line: 145, description: '重建权限规则链'},
  {function: 'injectPlanModeRules', file: 'src/utils/permissionRules.ts', line: 168, description: '注入 Plan 模式高优先级规则'},
  {function: 'useCanUseTool', file: 'src/hooks/useCanUseTool.ts', line: 12, description: '后续工具调用使用新规则集'}
]" />

### 5.5 Plan 模式的视觉反馈

当 Claude 在 Plan 模式下尝试使用被拒绝的工具时，UI 不会显示标准的权限错误，而是显示特定的 Plan 模式提示，引导用户先退出 Plan 模式。这一区分通过 `useCanUseTool` 返回的 `reason` 字段中的特殊标记实现。

---

## 六、完整权限检查时序图

将上述所有组件串联起来，一次完整的工具权限检查时序如下：

<CallChain :chain="[
  {function: 'Claude 决定调用工具', file: 'src/server/agent/loop.ts', line: 203, description: 'Agent 循环中选择工具'},
  {function: 'preflightCheck', file: 'src/client/permission/preflight.ts', line: 15, description: '前端预检'},
  {function: 'useCanUseTool', file: 'src/hooks/useCanUseTool.ts', line: 12, description: 'Hook 层权限判断'},
  {function: 'checkHardcodedDenyRules', file: 'src/utils/permissionRules.ts', line: 33, description: '① 硬编码规则检查'},
  {function: 'checkSandboxBounds', file: 'src/utils/sandbox.ts', line: 78, description: '② 沙箱边界检查'},
  {function: 'matchPermissionMode', file: 'src/utils/permissionRules.ts', line: 112, description: '③ 权限模式匹配'},
  {function: 'showConfirmationIfNeeded', file: 'src/context/promptOverlayContext.tsx', line: 101, description: 'Ask 模式下弹出确认'},
  {function: 'sendToolRequest', file: 'src/client/api/tools.ts', line: 56, description: '发送到后端'},
  {function: 'validateToolPermission', file: 'src/server/permission/validator.ts', line: 22, description: '后端独立校验'},
  {function: 'executeTool', file: 'src/server/tools/executor.ts', line: 89, description: '最终执行'}
]" />

---

## 七、设计哲学总结

Claude Code 权限模型的设计遵循以下原则：

1. **深度防御**：前端预检 + 后端校验双重保障，不信任任何单一检查点
2. **分层优先**：硬编码规则 > 沙箱边界 > 权限模式 > 用户确认，层级清晰不可逆
3. **最小权限**：Plan 模式体现了"默认拒绝，显式允许"的安全原则
4. **渐进信任**：Ask → Auto-Edit → Full-Auto 三级模式让用户按需选择信任级别
5. **规则可组合**：基于优先级的规则链允许细粒度覆盖粗粒度默认行为

这套模型确保了 Claude Code 在保持强大自动化能力的同时，将安全风险控制在可接受的边界内。
