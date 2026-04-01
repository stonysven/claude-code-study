<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{
  moduleName: string
}>()

const svgRef = ref<SVGSVGElement>()
const containerRef = ref<HTMLDivElement>()

interface GraphNode {
  id: string
  label: string
  fileCount: number
  x: number
  y: number
  fx?: number | null
  fy?: number | null
}

interface GraphEdge {
  source: string | GraphNode
  target: string | GraphNode
  count: number
}

interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

async function loadAndRender() {
  if (!svgRef.value) return

  const d3 = await import('d3')
  const dataUrl = '/dependencies.json'
  const resp = await fetch(dataUrl)
  const data: GraphData = await resp.json()

  if (!data.nodes.length) return

  const svg = d3.select(svgRef.value)
  svg.selectAll('*').remove()

  const width = 600
  const height = 400
  svg.attr('viewBox', `0 0 ${width} ${height}`)

  const g = svg.append('g')

  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.3, 3])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
    })
  d3.select(svgRef.value).call(zoom)

  const nodeMap = new Map(data.nodes.map(n => [n.id, { ...n, x: 0, y: 0 }]))

  const relevantNodes = new Set<string>([props.moduleName])
  for (const edge of data.edges) {
    if (edge.source === props.moduleName || edge.target === props.moduleName) {
      relevantNodes.add(String(edge.source))
      relevantNodes.add(String(edge.target))
    }
  }

  const filteredEdges = data.edges.filter(
    e => relevantNodes.has(String(e.source)) && relevantNodes.has(String(e.target))
  )

  const nodes = [...relevantNodes].map(id => nodeMap.get(id)!).filter(Boolean)
  const edges = filteredEdges.map(e => ({
    source: String(e.source),
    target: String(e.target),
    count: e.count,
  }))

  const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
    .force('link', d3.forceLink(edges).id((d: any) => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))

  const link = g.append('g')
    .selectAll('line')
    .data(edges)
    .join('line')
    .attr('stroke', 'var(--vp-c-divider)')
    .attr('stroke-width', d => Math.min(Math.sqrt(d.count), 3) + 0.5)

  const node = g.append('g')
    .selectAll('g')
    .data(nodes)
    .join('g')
    .style('cursor', 'pointer')

  node.append('circle')
    .attr('r', d => props.moduleName === d.id ? 16 : Math.max(8, Math.sqrt(d.fileCount) * 2))
    .attr('fill', d => props.moduleName === d.id ? 'var(--vp-c-brand-1)' : 'var(--vp-c-bg-mute)')
    .attr('stroke', d => props.moduleName === d.id ? 'var(--vp-c-brand-2)' : 'var(--vp-c-divider)')
    .attr('stroke-width', d => props.moduleName === d.id ? 2 : 1)

  node.append('text')
    .text(d => d.label)
    .attr('x', 0)
    .attr('y', d => props.moduleName === d.id ? 24 : 16)
    .attr('text-anchor', 'middle')
    .attr('fill', 'var(--vp-c-text-1)')
    .attr('font-size', d => props.moduleName === d.id ? '13px' : '11px')
    .attr('font-weight', d => props.moduleName === d.id ? '600' : '400')

  simulation.on('tick', () => {
    link
      .attr('x1', (d: any) => d.source.x)
      .attr('y1', (d: any) => d.source.y)
      .attr('x2', (d: any) => d.target.x)
      .attr('y2', (d: any) => d.target.y)
    node.attr('transform', (d: any) => `translate(${d.x},${d.y})`)
  })
}

onMounted(loadAndRender)
watch(() => props.moduleName, loadAndRender)
</script>

<template>
  <div ref="containerRef" class="module-graph">
    <svg ref="svgRef" width="100%" height="400" />
    <div class="module-graph-hint">拖拽缩放 · 滚轮缩放</div>
  </div>
</template>

<style scoped>
.module-graph {
  position: relative;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  margin: 16px 0;
  background: var(--vp-c-bg-soft);
}

.module-graph-hint {
  position: absolute;
  bottom: 8px;
  right: 12px;
  font-size: 11px;
  color: var(--vp-c-text-3);
  pointer-events: none;
}
</style>
