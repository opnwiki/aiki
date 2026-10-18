<template>
  <svg data-testid="mesh-map" viewBox="0 0 320 280" class="mx-auto block h-auto w-full max-w-xs text-zinc-700" role="img" :aria-label="label">
    <line
      v-for="link in links"
      :key="`${link.via}:${link.from}:${link.to}`"
      :x1="point(link.from).x"
      :y1="point(link.from).y"
      :x2="point(link.to).x"
      :y2="point(link.to).y"
      :stroke="link.via === 'directory' ? '#c5d1c9' : '#8aa899'"
      :stroke-width="link.via === 'directory' ? 1 : 2"
      data-testid="mesh-edge"
    />
    <g v-for="node in nodes" :key="node.url" :data-url="node.url" data-testid="mesh-node">
      <circle :cx="node.x" :cy="node.y" r="16" :fill="node.self ? 'var(--aiki-accent)' : '#f4f7f5'" :stroke="node.role === 'hub' ? '#3d5c4e' : '#8aa899'" :stroke-width="node.role === 'hub' ? 3 : 1.5" />
      <text :x="node.x" :y="node.y + 30" text-anchor="middle" fill="currentColor" font-size="11">{{ shortName(node.name) }}</text>
    </g>
  </svg>
</template>

<script setup>
const props = defineProps({
  nodes: { type: Array, default: () => [] },
  links: { type: Array, default: () => [] },
  label: { type: String, default: '' },
})

function point(url) {
  return props.nodes.find(node => node.url === url) || { x: 160, y: 132 }
}

function shortName(name) {
  const text = String(name || '')
  return text.length > 18 ? `${text.slice(0, 17)}…` : text
}
</script>
