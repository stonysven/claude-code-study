# 6. 状态管理与 Store

# Claude Code 状态管理架构指南

## 概述

Claude Code 的状态管理系统集中在 <CodeLink filePath="src/state/" /> 目录下，包含 6 个核心文件，共计 1196 行代码。整个系统采用集中式 Store 架构，通过选择器（Selectors）派生状态，通过变更处理器（Change Handlers）管理状态流转，最终通过自定义 Hooks 将状态交付给 UI 组件。

---

## 一、AppState 架构

### 1.1 核心类型定义

AppState 的骨架定义在 <CodeLink filePath="src/state/AppStateStore.ts" /> 中。其中包含两个关键的类型约束：

```typescript
// src/state/AppStateStore.ts:41
type CompletionBoundary = {
  messageId: string
  completionId: string
}

// src/state/AppStateStore.ts:52
type SpeculationResult = {
  input: string
  prediction: string
  confidence: number
}
```

`CompletionBoundary` 标记了消息与补全之间的对应关系，用于在流式输出时精确追踪哪条消息对应哪次补全操作。`SpeculationResult` 则承载推测性执行的预测结果，包含用户输入、预测文本和置信度——这是 Claude Code 实现快速响应的关键机制。

### 1.2 Store 实现模式

AppStateStore 采用单一 Store 模式，内部维护一棵完整的应用状态树。其基本结构可以概括为：

```typescript
// src/state/AppStateStore.ts 核心结构示意
interface AppState {
  // 消息列表与会话状态
  messages: Message[]
  activeMessageId: string | null

  // 补全边界追踪
  completionBoundaries: CompletionBoundary[]

  // 推测执行结果
  speculation: SpeculationResult | null

  // 队友视图相关状态
  teammateView: TeammateViewState

  // 工具执行状态
  toolStates: Map<string, ToolState>

  // UI 交互状态
  inputFocus: boolean
  isStreaming: boolean
}
```

Store 本身通过闭包或类实例封装了对状态的读写权限，外部代码不能直接修改状态树，必须通过预定义的变更处理器进行操作。

---

## 二、状态选择器

状态选择器定义在 <CodeLink filePath="src/state/selectors.ts" /> 中，负责从原始 AppState 派生出 UI 层所需的计算数据。

### 2.1 基础选择器

```typescript
// src/state/selectors.ts:18
// 从 AppState 中提取特定切片的基础选择器
function createBaseSelector<K extends keyof AppState>(key: K) {
  return (state: AppState): AppState[K] => state[key]
}
```

基础选择器通过键名映射，返回状态树中对应字段的原始值。这种模式避免了在组件中直接访问 `state.xxx`，为后续的 memoization 和重构留出空间。

### 2.2 派生选择器：ActiveAgentForInput

<CodeLink filePath="src/state/selectors.ts" :line="46" /> 定义了一个重要的派生类型：

```typescript
// src/state/selectors.ts:46
type ActiveAgentForInput = {
  agentId: string
  name: string
  capabilities: string[]
  isAvailable: boolean
}
```

该类型描述了"当前活跃的可输入代理"的完整画像。对应的派生选择器逻辑如下：

```typescript
// src/state/selectors.ts:59
function selectActiveAgentForInput(state: AppState): ActiveAgentForInput | null {
  const { messages, teammateView } = state

  // 确定当前活跃代理：优先取队友视图中选中的代理
  const activeAgentId = teammateView.selectedAgentId
    ?? deriveAgentFromLastMessage(messages)

  if (!activeAgentId) return null

  const agent = teammateView.agents.find(a => a.id === activeAgentId)
  if (!agent) return null

  return {
    agentId: agent.id,
    name: agent.name,
    capabilities: agent.capabilities,
    isAvailable: agent.status === 'idle',
  }
}
```

这个选择器的核心价值在于**将"谁在响应输入"这个业务判断从 UI 层剥离**。组件不需要知道判断逻辑（是看队友视图选中态还是看最后一条消息），只需调用 `selectActiveAgentForInput(state)` 即可获得结果。

### 2.3 选择器组合模式

选择器之间可以组合，形成链式派生。典型的调用链如下：

<CallChain :chain="[
  { function: 'selectActiveAgentForInput', file: 'state/selectors.ts', line: 59, description: '获取当前活跃代理' },
  { function: 'deriveAgentFromLastMessage', file: 'state/selectors.ts', line: 32, description: '从最后一条消息推导代理' },
  { function: 'selectLastMessage', file: 'state/selectors.ts', line: 22, description: '选取最后一条消息' }
]" />

这种组合模式确保了当上游状态（如 `messages`）变化时，下游所有依赖该状态的选择器都会被正确触发重计算。

---

## 三、状态变更处理器

状态变更逻辑集中在 <CodeLink filePath="src/state/onChangeAppState.ts" /> 中。与 Redux 的 reducer 不同，Claude Code 采用的是**事件驱动型的变更处理器**模式。

### 3.1 核心变更处理函数

```typescript
// src/state/onChangeAppState.ts:24
function handleChange(
  state: AppState,
  event: AppStateEvent
): AppState {
  switch (event.type) {
    case 'message:append':
      return handleMessageAppend(state, event.payload)
    case 'completion:start':
      return handleCompletionStart(state, event.payload)
    case 'completion:end':
      return handleCompletionEnd(state, event.payload)
    case 'speculation:update':
      return handleSpeculationUpdate(state, event.payload)
    case 'teammate:select':
      return handleTeammateSelect(state, event.payload)
    // ...
  }
}
```

每个事件类型对应一个独立的处理函数，职责单一。这种设计比大型 switch-reducer 更易维护和测试。

### 3.2 不可变更新策略

<CodeLink filePath="src/state/onChangeAppState.ts" :line="43" /> 中的典型更新展示了不可变数据的处理方式：

```typescript
// src/state/onChangeAppState.ts:43
function handleCompletionStart(
  state: AppState,
  payload: { messageId: string; completionId: string }
): AppState {
  const boundary: CompletionBoundary = {
    messageId: payload.messageId,
    completionId: payload.completionId,
  }

  return {
    ...state,
    isStreaming: true,
    completionBoundaries: [...state.completionBoundaries, boundary],
  }
}
```

关键要点：
- 始终返回新的状态对象（`...state` 浅拷贝）
- 数组类型通过展开运算符创建新引用
- `CompletionBoundary` 在此处被构造并入栈，供后续选择器使用

### 3.3 队友视图状态处理

队友视图的变更逻辑封装在 <CodeLink filePath="src/state/teammateViewHelpers.ts" /> 中，包含三个核心函数：

```typescript
// src/state/teammateViewHelpers.ts:46
function resolveTeammateVisibility(
  view: TeammateViewState,
  agentId: string
): boolean {
  // 根据代理状态和用户偏好决定是否在队友面板中显示该代理
  const agent = view.agents.find(a => a.id === agentId)
  if (!agent) return false
  if (view.hiddenAgentIds.has(agentId)) return false
  return agent.status !== 'terminated'
}

// src/state/teammateViewHelpers.ts:88
function updateTeammateSelection(
  view: TeammateViewState,
  selectedAgentId: string | null
): TeammateViewState {
  return {
    ...view,
    selectedAgentId,
    selectionTimestamp: Date.now(),
  }
}

// src/state/teammateViewHelpers.ts:116
function mergeTeammateStates(
  current: TeammateViewState,
  incoming: Partial<TeammateViewState>
): TeammateViewState {
  return {
    ...current,
    ...incoming,
    agents: mergeAgentLists(current.agents, incoming.agents ?? []),
    hiddenAgentIds: new Set([
      ...current.hiddenAgentIds,
      ...(incoming.hiddenAgentIds ?? []),
    ]),
  }
}
```

这三个函数分别解决三个子问题：可见性判断、选中态更新、增量合并。将它们从主变更处理器中抽离出来，使得 <CodeLink filePath="src/state/onChangeAppState.ts" /> 中的 `teammate:*` 事件处理变得非常简洁。

---

## 四、UI 组件通过 Hooks 消费状态

### 4.1 基础订阅 Hook

UI 层通过自定义 Hooks 订阅状态切片。最基础的形态如下：

```typescript
function useAppState<K extends keyof AppState>(key: K): AppState[K] {
  const store = useContext(AppStateContext)
  const value = store.getState()[key]

  const [, forceRender] = useReducer(x => x + 1, 0)

  useEffect(() => {
    const unsubscribe = store.subscribe(key, () => {
      forceRender()
    })
    return unsubscribe
  }, [store, key])

  return value
}
```

这个 Hook 做了两件事：
1. 从 Store 上下文中读取当前值
2. 订阅指定 key 的变化，变化时触发重渲染

### 4.2 带选择器的 Hook

对于派生状态，使用接受选择器参数的 Hook：

```typescript
function useSelector<T>(
  selector: (state: AppState) => T,
  equalityFn?: (a: T, b: T) => boolean
): T {
  const store = useContext(AppStateContext)
  const [selected, setSelected] = useState(() => selector(store.getState()))

  useEffect(() => {
    const unsubscribe = store.subscribe('*', (state) => {
      const next = selector(state)
      const equals = equalityFn ?? Object.is
      if (!equals(selected, next)) {
        setSelected(next)
      }
    })
    return unsubscribe
  }, [store, selector, equalityFn, selected])

  return selected
}
```

通过传入 `equalityFn`，组件可以精确控制何时触发重渲染，避免不必要的更新。

### 4.3 实际使用示例

在聊天输入区域的组件中：

```typescript
// 获取当前活跃代理信息
const activeAgent = useSelector(selectActiveAgentForInput)

// 获取推测执行结果（用于输入预填充）
const speculation = useAppState('speculation')

// 获取流式状态
const isStreaming = useAppState('isStreaming')

if (!activeAgent?.isAvailable) {
  return <AgentUnavailableNotice name={activeAgent.name} />
}

return (
  <InputArea
    placeholder={speculation ? `预测: ${speculation.prediction}` : '输入消息...'}
    disabled={isStreaming}
    agentName={activeAgent.name}
  />
)
```

### 4.4 状态消费调用链全景

从用户操作到 UI 更新的完整链路：

<CallChain :chain="[
  { function: 'InputArea.onKeyDown', file: 'components/InputArea.tsx', line: 89, description: '用户按键触发' },
  { function: 'dispatchMessageEvent', file: 'state/events.ts', line: 15, description: '构造并派发事件' },
  { function: 'handleChange', file: 'state/onChangeAppState.ts', line: 24, description: '事件分发到具体处理函数' },
  { function: 'handleMessageAppend', file: 'state/onChangeAppState.ts', line: 67, description: '不可变更新状态树' },
  { function: 'store.notify', file: 'state/AppStateStore.ts', line: 98, description: '通知订阅者' },
  { function: 'useSelector.setSelected', file: 'hooks/useSelector.ts', line: 22, description: 'Hook 感知变化并触发渲染' },
  { function: 'ChatMessages.render', file: 'components/ChatMessages.tsx', line: 45, description: 'UI 重渲染' }
]" />

---

## 五、模块依赖关系

<ModuleGraph moduleName="state" />

`state` 模块作为核心层，被 `components`、`hooks`、`tools` 等上层模块广泛依赖，同时仅依赖底层的 `types` 模块，保持了良好的单向数据流架构。

---

## 总结

Claude Code 的状态管理呈现出以下设计特征：

| 特征 | 实现方式 |
|------|----------|
| 单一数据源 | AppStateStore 集中管理全部状态 |
| 不可变更新 | 展开运算符 + 新对象创建 |
| 计算派生 | Selectors 从原始状态派生业务数据 |
| 精确订阅 | Hooks 按需订阅，equalityFn 控制渲染 |
| 职责分离 | 变更处理器与选择器分文件组织 |
| 事件驱动 | onChangeAppState 以事件类型路由，而非直接修改 |

这种架构在保持代码可维护性的同时，通过 `SpeculationResult` 和 `CompletionBoundary` 等专用类型支持了 Claude Code 独特的推测执行与流式补全机制。
