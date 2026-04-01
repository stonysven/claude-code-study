import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { join, relative, extname } from 'path'

interface ExportInfo {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'default'
  signature?: string
  jsDoc?: string
  line: number
  file: string
}

interface ImportInfo {
  source: string
  names: string[]
  file: string
}

interface ModuleInfo {
  name: string
  path: string
  description: string
  files: string[]
  exports: ExportInfo[]
  imports: ImportInfo[]
  fileCount: number
  lineCount: number
}

interface AnalysisResult {
  modules: ModuleInfo[]
  exports: ExportInfo[]
  imports: ImportInfo[]
  analyzedAt: string
}

const SRC_CODE_DIR = join(import.meta.dir, '..', 'src-code')
const DATA_DIR = join(import.meta.dir, '..', 'data')

const SKIP_DIRS = new Set(['node_modules', '__tests__', 'test', 'testing', 'stubs', '.git'])

function isTsFile(filePath: string): boolean {
  const ext = extname(filePath)
  return ext === '.ts' || ext === '.tsx'
}

function readDirRecursive(dir: string, base: string = dir): string[] {
  if (!existsSync(dir)) return []
  const entries = readdirSync(dir)
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue
      files.push(...readDirRecursive(fullPath, base))
    } else if (isTsFile(entry)) {
      files.push(relative(base, fullPath))
    }
  }
  return files
}

function countLines(filePath: string): number {
  const content = readFileSync(filePath, 'utf-8')
  return content.split('\n').length
}

function extractExports(fileContent: string, filePath: string): ExportInfo[] {
  const exports: ExportInfo[] = []
  const lines = fileContent.split('\n')

  const patterns: { regex: RegExp; kind: ExportInfo['kind'] }[] = [
    { regex: /^export\s+(async\s+)?function\s+(\w+)/, kind: 'function' },
    { regex: /^export\s+class\s+(\w+)/, kind: 'class' },
    { regex: /^export\s+interface\s+(\w+)/, kind: 'interface' },
    { regex: /^export\s+type\s+(\w+)/, kind: 'type' },
    { regex: /^export\s+const\s+(\w+)/, kind: 'const' },
    { regex: /^export\s+enum\s+(\w+)/, kind: 'enum' },
    { regex: /^export\s+default\s+/, kind: 'default' },
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('export')) continue

    for (const { regex, kind } of patterns) {
      const match = line.match(regex)
      if (match) {
        exports.push({
          name: kind === 'default' ? 'default' : match[1],
          kind,
          signature: line.replace(/\{.*$/, '').trim().substring(0, 120),
          line: i + 1,
          file: filePath,
        })
        break
      }
    }
  }

  return exports
}

function extractImports(fileContent: string, filePath: string): ImportInfo[] {
  const imports: ImportInfo[] = []
  const regex = /import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['"](\.[^'"]+)['"]/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(fileContent)) !== null) {
    const names = match[1]
      ? match[1].split(',').map(n => n.trim().split(/\s+as\s+/).pop()!.trim())
      : match[2]
        ? [match[2]]
        : []
    imports.push({
      source: match[3],
      names,
      file: filePath,
    })
  }

  return imports
}

function inferDescription(dirName: string): string {
  const descriptions: Record<string, string> = {
    tools: 'Tool 系统核心，包含所有内置工具实现（文件操作、Shell 执行、代码搜索等）',
    commands: 'Command 系统核心，包含所有斜杠命令实现',
    skills: 'Skill 框架，负责技能加载、注册和管理',
    state: '状态管理，包含 AppState Store 和状态选择器',
    hooks: 'React Hooks 集合，提供 UI 层的状态管理和交互逻辑',
    plugins: '插件系统，包含内置插件和插件加载机制',
    services: '服务层，提供 MCP、API、远程连接等后端服务',
    assistant: 'Assistant 核心，处理对话消息和 AI 交互',
    bootstrap: '启动引导，负责应用初始化流程',
    cli: 'CLI 入口，命令行参数解析和启动逻辑',
    components: 'React UI 组件，终端界面渲染',
    context: '上下文管理，提供全局上下文和依赖注入',
    coordinator: '协调器，管理多代理协作',
    entrypoints: '应用入口点定义',
    keybindings: '键盘快捷键管理',
    remote: '远程连接和会话管理',
    schemas: 'JSON Schema 定义和数据验证',
    server: '本地服务器和 IPC 通信',
    tasks: '任务管理系统',
    types: 'TypeScript 类型定义',
    utils: '工具函数集合',
    ink: 'Ink 渲染引擎适配层',
    constants: '常量定义',
  }
  return descriptions[dirName] || `${dirName} 模块`
}

function analyze(): AnalysisResult {
  const topDirs = readdirSync(SRC_CODE_DIR).filter(entry => {
    const fullPath = join(SRC_CODE_DIR, entry)
    return statSync(fullPath).isDirectory() && !SKIP_DIRS.has(entry)
  })

  const modules: ModuleInfo[] = []
  const allExports: ExportInfo[] = []
  const allImports: ImportInfo[] = []

  for (const dirName of topDirs.sort()) {
    const dirPath = join(SRC_CODE_DIR, dirName)
    const files = readDirRecursive(dirPath, SRC_CODE_DIR)

    const tsFiles = files.filter(f => isTsFile(f))
    if (tsFiles.length === 0) continue

    let totalLines = 0
    const exports: ExportInfo[] = []
    const imports: ImportInfo[] = []

    for (const file of tsFiles) {
      const fullPath = join(SRC_CODE_DIR, file)
      if (!existsSync(fullPath)) continue
      const content = readFileSync(fullPath, 'utf-8')
      totalLines += countLines(fullPath)

      exports.push(...extractExports(content, file))
      imports.push(...extractImports(content, file))
    }

    allExports.push(...exports)
    allImports.push(...imports)

    modules.push({
      name: dirName,
      path: `src/${dirName}/`,
      description: inferDescription(dirName),
      files: tsFiles,
      exports,
      imports,
      fileCount: tsFiles.length,
      lineCount: totalLines,
    })
  }

  return {
    modules,
    exports: allExports,
    imports: allImports,
    analyzedAt: new Date().toISOString(),
  }
}

const result = analyze()
const outputPath = join(DATA_DIR, 'analysis.json')

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8')

console.log(`Analysis complete. ${result.modules.length} modules, ${result.exports.length} exports, ${result.imports.length} imports`)
console.log(`Output: ${outputPath}`)
