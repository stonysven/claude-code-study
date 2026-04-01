# Claude Code 源码解析

系统性学习 Claude Code CLI 源码的中文文档站，基于 [anthropics/claude-code](https://github.com/anthropics/claude-code) 源码，通过自动分析 + LLM 生成的方式产出结构化的学习文档。

## 在线预览

```bash
bun run docs:dev
```

访问 `http://localhost:5173/zh/` 查看文档站。

## 项目结构

```
claude-code-study/
├── scripts/
│   ├── analyze.ts          # 分析 Claude Code 源码，提取模块信息
│   ├── generate-index.ts   # 生成模块索引页面 (docs/zh/modules.md)
│   └── generate-content.ts # 调用 LLM 生成各章节文档
├── docs/zh/
│   ├── guide/              # 原理篇 — 按架构模块讲解
│   │   ├── architecture.md     # 整体架构概览
│   │   ├── entry.md            # 启动与初始化流程
│   │   ├── tool-system.md      # Tool 系统
│   │   ├── command-system.md   # Command 系统
│   │   ├── skill-system.md     # Skill 框架
│   │   ├── state-management.md # 状态管理与 Store
│   │   ├── api-layer.md        # API 通信层
│   │   ├── mcp-protocol.md     # MCP 协议集成
│   │   └── agent-architecture.md # Agent 多代理架构
│   └── walkthrough/         # 走读篇 — 按功能场景追踪代码路径
│       ├── conversation-flow.md   # 完整对话处理链路
│       ├── file-edit-pipeline.md  # 文件编辑管线
│       ├── agent-dispatch.md      # Agent 调度与执行
│       ├── permission-model.md    # 权限校验模型
│       └── plugin-extension.md    # 插件与扩展机制
├── data/                  # 分析产出的中间数据 (index.json)
└── src-code/              # Claude Code 源码目录 (gitignore)
```

## 快速开始

### 1. 准备 Claude Code 源码

将 Claude Code 源码克隆到项目根目录的 `src-code/` 文件夹：

```bash
git clone https://github.com/anthropics/claude-code.git src-code
```

### 2. 安装依赖

```bash
bun install
```

### 3. 配置 LLM

复制 `.env.example` 为 `.env` 并填写你的 LLM 配置：

```bash
cp .env.example .env
```

```env
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
LLM_MODEL=glm-4-plus
LLM_API_KEY=你的密钥
```

支持任何兼容 OpenAI Chat Completions API 的服务。

### 4. 生成文档

```bash
# 第一步：分析源码，提取模块信息
bun run analyze

# 第二步：生成模块索引页面
bun run generate:index

# 第三步：调用 LLM 生成各章节文档
bun run generate:content

# 跳过已生成的章节，只处理未完成的
bun run generate:content -- --skip-existing

# 只重新生成指定章节
bun run generate:content -- guide/tool-system.md
```

## 构建与部署

```bash
# 构建静态站点
bun run docs:build

# 本地预览构建结果
bun run docs:preview
```

## 技术栈

- **文档框架**: [VitePress](https://vitepress.dev/)
- **运行时**: [Bun](https://bun.sh/)
- **内容生成**: OpenAI 兼容 API
- **源码分析**: 自研 AST 解析脚本

## 章节内容

### 原理篇 (Guide)

从宏观架构出发，系统讲解 Claude Code 各核心子系统的设计与实现：

1. **整体架构概览** — 核心模块职责、数据流、设计模式
2. **启动与初始化流程** — CLI 参数解析、Bootstrap 序列
3. **Tool 系统** — 工具接口定义、注册调度、权限模型
4. **Command 系统** — 斜杠命令路由、分类与实现
5. **Skill 框架** — 技能加载机制与执行生命周期
6. **状态管理** — AppState 架构与 UI 状态消费
7. **API 通信层** — Claude API 集成、会话管理、限流重试
8. **MCP 协议集成** — MCP 服务端连接、插件系统
9. **Agent 多代理架构** — Agent 定义、调度、子代理隔离

### 走读篇 (Walkthrough)

按功能场景追踪完整代码路径，带 file:line 引用：

10. **完整对话处理链路** — 从用户输入到响应渲染
11. **文件编辑管线** — 读写、diff 编辑、权限校验、冲突处理
12. **Agent 调度与执行** — 创建、生命周期、Worktree 隔离
13. **权限校验模型** — 权限模式、沙箱、安全边界
14. **插件与扩展机制** — 插件加载、钩子、自定义工具注册

## License

MIT
