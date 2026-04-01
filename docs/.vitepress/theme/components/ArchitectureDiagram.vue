<script setup lang="ts">
withDefaults(defineProps<{
  src: string
  highlights?: string[]
}>(), {
  highlights: () => [],
})
</script>

<template>
  <div class="arch-diagram">
    <div class="arch-diagram-scroll">
      <img :src="src" :alt="src" class="arch-diagram-img" loading="lazy" />
    </div>
  </div>
</template>

<style scoped>
.arch-diagram {
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  margin: 16px 0;
  background: var(--vp-c-bg-soft);
}

.arch-diagram-scroll {
  overflow-x: auto;
  padding: 16px;
  display: flex;
  justify-content: center;
}

.arch-diagram-img {
  max-width: 100%;
  height: auto;
}
</style>
