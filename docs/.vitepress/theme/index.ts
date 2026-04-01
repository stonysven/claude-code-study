import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import './styles/index.css'

// Components
import CodeLink from './components/CodeLink.vue'
import CodeBlock from './components/CodeBlock.vue'
import CallChain from './components/CallChain.vue'
import ModuleGraph from './components/ModuleGraph.vue'
import ArchitectureDiagram from './components/ArchitectureDiagram.vue'
import ModuleIndex from './components/ModuleIndex.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('CodeLink', CodeLink)
    app.component('CodeBlock', CodeBlock)
    app.component('CallChain', CallChain)
    app.component('ModuleGraph', ModuleGraph)
    app.component('ArchitectureDiagram', ArchitectureDiagram)
    app.component('ModuleIndex', ModuleIndex)
  },
} satisfies Theme
