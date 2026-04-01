<script setup lang="ts">
interface CallNode {
  function: string
  file: string
  line?: number
  description?: string
  children?: CallNode[]
}

defineProps<{
  chain: CallNode[]
}>()

function getGitHubUrl(file: string, line?: number): string {
  const path = file.replace(/^src-code\//, 'src/')
  const suffix = line ? `#L${line}` : ''
  return `https://github.com/anthropics/claude-code/blob/main/${path}${suffix}`
}

function getFileName(file: string): string {
  const parts = file.replace(/^.*\/src\//, '').split('/')
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : parts.join('/')
}
</script>

<template>
  <div class="call-chain">
    <div v-for="(node, index) in chain" :key="index" class="call-node">
      <div class="call-timeline">
        <div class="call-dot" />
        <div v-if="index < chain.length - 1" class="call-line" />
      </div>

      <div class="call-content">
        <div class="call-header">
          <code class="call-function">{{ node.function }}</code>
          <a
            v-if="node.file"
            :href="getGitHubUrl(node.file, node.line)"
            target="_blank"
            rel="noopener noreferrer"
            class="call-file"
          >
            {{ getFileName(node.file) }}{{ node.line ? `:${node.line}` : '' }}
          </a>
        </div>
        <div v-if="node.description" class="call-description">
          {{ node.description }}
        </div>

        <div v-if="node.children?.length" class="call-children">
          <CallChain :chain="node.children" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.call-chain {
  padding: 8px 0;
}

.call-node {
  display: flex;
  gap: 12px;
}

.call-timeline {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 20px;
  flex-shrink: 0;
}

.call-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  flex-shrink: 0;
  margin-top: 6px;
}

.call-line {
  width: 2px;
  flex-grow: 1;
  background: var(--vp-c-divider);
  min-height: 20px;
}

.call-content {
  flex: 1;
  padding-bottom: 12px;
}

.call-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.call-function {
  font-size: 14px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  padding: 2px 8px;
  border-radius: 4px;
}

.call-file {
  font-size: 12px;
  color: var(--vp-c-text-3);
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  text-decoration: none;
}

.call-file:hover {
  color: var(--vp-c-brand-1);
  text-decoration: underline;
}

.call-description {
  font-size: 13px;
  color: var(--vp-c-text-2);
  margin-top: 4px;
  line-height: 1.6;
}

.call-children {
  margin-left: 20px;
  margin-top: 8px;
  padding-left: 12px;
  border-left: 2px solid var(--vp-c-divider);
}
</style>
