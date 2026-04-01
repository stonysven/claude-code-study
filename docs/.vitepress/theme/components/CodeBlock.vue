<script setup lang="ts">
import { ref, computed } from 'vue'

interface FileEntry {
  path: string
  lang?: string
  highlightLines?: number[]
  label?: string
  code: string
}

const props = withDefaults(defineProps<{
  files: FileEntry[]
  previewLines?: number
}>(), {
  previewLines: 15,
})

const activeTab = ref(0)
const expanded = ref(false)

const activeFile = computed(() => props.files[activeTab.value])

const previewCode = computed(() => {
  if (!activeFile.value) return ''
  const lines = activeFile.value.code.split('\n')
  return lines.slice(0, props.previewLines).join('\n')
})

const hasMore = computed(() => {
  if (!activeFile.value) return false
  return activeFile.value.code.split('\n').length > props.previewLines
})

const totalLines = computed(() => {
  return activeFile.value?.code.split('\n').length || 0
})

function toggleExpand() {
  expanded.value = !expanded.value
}

function selectTab(index: number) {
  activeTab.value = index
  expanded.value = false
}
</script>

<template>
  <div class="code-block">
    <div v-if="files.length > 1" class="code-block-tabs">
      <button
        v-for="(file, index) in files"
        :key="index"
        class="code-block-tab"
        :class="{ active: index === activeTab }"
        @click="selectTab(index)"
      >
        {{ file.label || file.path.split('/').pop() }}
      </button>
    </div>

    <div class="code-block-content">
      <div class="code-block-path">{{ activeFile?.path }}</div>
      <div class="vp-doc">
        <div :class="['language-', activeFile?.lang || 'typescript']">
          <pre class="shiki"><code><span v-html="expanded ? activeFile?.code : previewCode"></span></code></pre>
        </div>
      </div>

      <div v-if="hasMore" class="code-block-footer">
        <button class="code-block-toggle" @click="toggleExpand">
          {{ expanded ? '收起' : `展开全部 (${totalLines} 行)` }}
          <svg
            class="toggle-icon"
            :class="{ expanded }"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.code-block {
  border-radius: 8px;
  border: 1px solid var(--vp-c-divider);
  overflow: hidden;
  margin: 16px 0;
}

.code-block-tabs {
  display: flex;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  overflow-x: auto;
}

.code-block-tab {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--vp-c-text-2);
  background: none;
  border: none;
  cursor: pointer;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  transition: color 0.2s, border-color 0.2s;
}

.code-block-tab:hover {
  color: var(--vp-c-text-1);
}

.code-block-tab.active {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
}

.code-block-content {
  position: relative;
}

.code-block-path {
  padding: 8px 16px;
  font-size: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--vp-c-text-3);
  background: var(--vp-c-bg-mute);
  border-bottom: 1px solid var(--vp-c-divider);
}

.code-block-content pre {
  margin: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
}

.code-block-content code {
  font-size: 13px;
}

.code-block-footer {
  padding: 8px;
  text-align: center;
  border-top: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.code-block-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  font-size: 13px;
  color: var(--vp-c-brand-1);
  background: none;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.code-block-toggle:hover {
  background: var(--vp-c-brand-soft);
}

.toggle-icon {
  transition: transform 0.2s;
}

.toggle-icon.expanded {
  transform: rotate(180deg);
}
</style>
