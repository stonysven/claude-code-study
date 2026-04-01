import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname, resolve } from 'path'

const DATA_DIR = join(import.meta.dir, '..', 'data')

interface ExportInfo {
  name: string
  kind: string
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

interface DependencyEdge {
  from: string
  to: string
  count: number
}

interface CallGraphEntry {
  function: string
  file: string
  line: number
  calls: { function: string; module: string; file: string }[]
}

function generateIndex(analysis: AnalysisResult) {
  const index = {
    modules: analysis.modules.map(m => ({
      name: m.name,
      path: m.path,
      description: m.description,
      fileCount: m.fileCount,
      lineCount: m.lineCount,
      exports: m.exports.slice(0, 20).map(e => ({
        name: e.name,
        kind: e.kind,
        line: e.line,
        file: e.file,
      })),
    })),
    totalFiles: analysis.modules.reduce((sum, m) => sum + m.fileCount, 0),
    totalLines: analysis.modules.reduce((sum, m) => sum + m.lineCount, 0),
    generatedAt: analysis.analyzedAt,
  }

  const depMap = new Map<string, Map<string, number>>()

  for (const module of analysis.modules) {
    const deps = new Map<string, number>()
    for (const imp of module.imports) {
      let resolvedModule = ''
      const source = imp.source
      if (source.startsWith('.')) {
        const importedFile = resolve(dirname(imp.file), source + (source.endsWith('.ts') || source.endsWith('.tsx') ? '' : '.ts'))
        const importedRel = importedFile.replace(/^.*\/src\//, 'src/')
        for (const m of analysis.modules) {
          if (importedRel.startsWith(m.path)) {
            resolvedModule = m.name
            break
          }
        }
      } else if (source.startsWith('src/')) {
        for (const m of analysis.modules) {
          if (source.startsWith(m.path)) {
            resolvedModule = m.name
            break
          }
        }
      }

      if (resolvedModule && resolvedModule !== module.name) {
        deps.set(resolvedModule, (deps.get(resolvedModule) || 0) + imp.names.length)
      }
    }

    if (deps.size > 0) {
      depMap.set(module.name, deps)
    }
  }

  const dependencies: DependencyEdge[] = []
  for (const [from, deps] of depMap) {
    for (const [to, count] of deps) {
      dependencies.push({ from, to, count })
    }
  }

  const dependenciesData = {
    nodes: analysis.modules.map(m => ({
      id: m.name,
      label: m.name,
      fileCount: m.fileCount,
      lineCount: m.lineCount,
    })),
    edges: dependencies,
  }

  const callGraph: CallGraphEntry[] = []
  for (const module of analysis.modules) {
    for (const exp of module.exports) {
      if (exp.kind !== 'function' && exp.kind !== 'class') continue
      callGraph.push({
        function: exp.name === 'default' ? `${exp.file} (default)` : exp.name,
        file: exp.file,
        line: exp.line,
        calls: module.imports
          .filter(imp => {
            const importedFile = resolve(dirname(imp.file), imp.source + '.ts')
            return importedFile.includes(exp.file.replace(/[^/]+$/, ''))
          })
          .map(imp => ({
            function: imp.names[0] || '(anonymous)',
            module: imp.file.split('/')[1] || '',
            file: imp.file,
          })),
      })
    }
  }

  const sidebarData = {
    guide: {
      title: '原理篇',
      items: [
        { id: 'architecture', title: '整体架构概览', modules: [] as string[] },
        { id: 'entry', title: '启动与初始化流程', modules: ['cli', 'bootstrap'] },
        { id: 'tool-system', title: 'Tool 系统', modules: ['tools'] },
        { id: 'command-system', title: 'Command 系统', modules: ['commands'] },
        { id: 'skill-system', title: 'Skill 框架', modules: ['skills'] },
        { id: 'state-management', title: '状态管理', modules: ['state'] },
        { id: 'api-layer', title: 'API 通信层', modules: ['services', 'remote'] },
        { id: 'mcp-protocol', title: 'MCP 协议', modules: ['services'] },
        { id: 'agent-architecture', title: 'Agent 多代理', modules: ['assistant', 'coordinator'] },
      ],
    },
    walkthrough: {
      title: '走读篇',
      items: [
        { id: 'conversation-flow', title: '完整对话处理链路', modules: ['assistant', 'hooks'] },
        { id: 'file-edit-pipeline', title: '文件编辑管线', modules: ['tools'] },
        { id: 'agent-dispatch', title: 'Agent 调度与执行', modules: ['tools', 'coordinator'] },
        { id: 'permission-model', title: '权限校验模型', modules: ['hooks', 'context'] },
        { id: 'plugin-extension', title: '插件与扩展', modules: ['plugins'] },
      ],
    },
  }

  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })

  writeFileSync(join(DATA_DIR, 'index.json'), JSON.stringify(index, null, 2))
  writeFileSync(join(DATA_DIR, 'dependencies.json'), JSON.stringify(dependenciesData, null, 2))
  writeFileSync(join(DATA_DIR, 'call-graph.json'), JSON.stringify(callGraph, null, 2))
  writeFileSync(join(DATA_DIR, 'sidebar-data.json'), JSON.stringify(sidebarData, null, 2))

  console.log(`Generated 4 index files in ${DATA_DIR}/`)
  console.log(`  index.json: ${index.modules.length} modules indexed`)
  console.log(`  dependencies.json: ${dependencies.length} dependency edges`)
  console.log(`  call-graph.json: ${callGraph.length} call graph entries`)
  console.log(`  sidebar-data.json: sidebar structure derived`)
}

const analysisPath = join(DATA_DIR, 'analysis.json')
if (!existsSync(analysisPath)) {
  console.error('Error: analysis.json not found. Run "bun run analyze" first.')
  process.exit(1)
}

const analysis: AnalysisResult = JSON.parse(readFileSync(analysisPath, 'utf-8'))
generateIndex(analysis)
