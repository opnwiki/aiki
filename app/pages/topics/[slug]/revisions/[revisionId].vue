<script setup>
const route = useRoute()
const slug = encodeURIComponent(String(route.params.slug || ''))
const revisionId = encodeURIComponent(String(route.params.revisionId || ''))
await navigateTo(`/${slug}/revisions/${revisionId}`, { redirectCode: 301, replace: true })
</script>
