<script setup>
const route = useRoute()
await navigateTo(`/${encodeURIComponent(String(route.params.slug || ''))}`, { redirectCode: 301, replace: true })
</script>
