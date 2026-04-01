<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

interface ModuleSummary {
  name: string
  path: string
  description: string
  fileCount: number
  lineCount: number
  exports: { name: string; kind: string; line: number; file: string }[]
}

const modules = ref<ModuleSummary[]>([])
const searchQuery = ref('')
const sortBy = ref<'name' | 'files' | 'lines'>('name')
const loading = ref(true)

onMounted(async () => {
  try {
    const resp = await fetch('/index.json')
    const data = await resp.json()
    modules.value = data.modules || []
  } catch (e) {
    console.error('Failed to load module index:', e)
  } finally {
    loading.value = false
  }
})

const filteredModules = computed(() => {
  let result = modules.value

  if (searchQuery.value) {
    const q = searchQuery.value.toLowerCase()
    result = result.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.exports.some(e => e.name.toLowerCase().includes(q))
    )
  }

  return [...result].sort((a, b) => {
    switch (sortBy.value) {
      case 'files': return b.fileCount - a.fileCount
      case 'lines': return b.lineCount - a.lineCount
      default: return a.name.localeCompare(b.name)
    }
  })
})

function formatNumber(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

function getModuleHref(name: string): string {
  const mapping: Record<string, string> = {
    tools: '/zh/guide/tool-system',
    commands: '/zh/guide/command-system',
    skills: '/zh/guide/skill-system',
    state: '/zh/guide/state-management',
    hooks: '/zh/guide/architecture',
    plugins: '/zh/walkthrough/plugin-extension',
    services: '/zh/guide/mcp-protocol',
    assistant: '/zh/guide/agent-architecture',
    bootstrap: '/zh/guide/entry',
    cli: '/zh/guide/entry',
  }
  return mapping[name] || '/zh/modules'
}
</script>

<template>
  <div class="module-index">
    <div class="module-controls">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="搜索模块、函数名..."
        class="module-search"
      />
      <div class="module-sort">
        <span class="sort-label">排序:</span>
        <button
          v-for="option in ([
            { value: 'name', label: '名称' },
            { value: 'files', label: '文件数' },
            { value: 'lines', label: '代码行' },
          ] as const)"
          :key="option.value"
          class="sort-btn"
          :class="{ active: sortBy === option.value }"
          @click="sortBy = option.value"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <div class="module-stats">
      共 {{ filteredModules.length }} 个模块
      · {{ filteredModules.reduce((s, m) => s + m.fileCount, 0) }} 个文件
      · {{ formatNumber(filteredModules.reduce((s, m) => s + m.lineCount, 0)) }} 行代码
    </div>

    <div v-if="loading" class="module-loading">加载中...</div>

    <div v-else class="module-grid">
      <a
        v-for="mod in filteredModules"
        :key="mod.name"
        :href="getModuleHref(mod.name)"
        class="module-card"
      >
        <div class="module-card-header">
          <span class="module-name">{{ mod.name }}</span>
          <span class="module-badge">{{ mod.fileCount }} 文件</span>
        </div>
        <p class="module-desc">{{ mod.description }}</p>
        <div class="module-meta">
          <span>{{ formatNumber(mod.lineCount) }} 行</span>
          <span>{{ mod.exports.length }} 导出</span>
        </div>
        <div v-if="mod.exports.length" class="module-exports">
          <code
            v-for="exp in mod.exports.slice(0, 5)"
            :key="exp.name"
            class="export-tag"
          >{{ exp.name }}</code>
          <span v-if="mod.exports.length > 5" class="export-more">
            +{{ mod.exports.length - 5 }}
          </span>
        </div>
      </a>
    </div>

    <div v-if="!loading && filteredModules.length === 0" class="module-empty">
      未找到匹配的模块
    </div>
  </div>
</template>

<style scoped>
.module-controls {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.module-search {
  flex: 1;
  min-width: 200px;
  padding: 8px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  font-size: 14px;
}

.module-search::placeholder {
  color: var(--vp-c-text-3);
}

.module-sort {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sort-label {
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin-right: 4px;
}

.sort-btn {
  padding: 6px 10px;
  font-size: 12px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.2s;
}

.sort-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-1);
}

.sort-btn.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.module-stats {
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin-bottom: 16px;
}

.module-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 12px;
}

.module-card {
  display: block;
  padding: 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.module-card:hover {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.dark .module-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.module-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.module-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.module-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.module-desc {
  font-size: 13px;
  color: var(--vp-c-text-2);
  line-height: 1.5;
  margin: 0 0 8px;
}

.module-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--vp-c-text-3);
  margin-bottom: 8px;
}

.module-exports {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.export-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--vp-c-bg-mute);
  color: var(--vp-c-text-2);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

.export-more {
  font-size: 11px;
  color: var(--vp-c-text-3);
  padding: 1px 4px;
}

.module-loading,
.module-empty {
  text-align: center;
  padding: 40px;
  color: var(--vp-c-text-3);
  font-size: 14px;
}

@media (max-width: 640px) {
  .module-grid {
    grid-template-columns: 1fr;
  }
}
</style>
