<template>
  <PublicProfile v-if="data?.profile" :data="data" />
</template>

<script setup>
const route = useRoute()
const { locale } = useLocale()
const { data, error } = await useFetch(() => `/api/actors/${encodeURIComponent(String(route.params.publicId))}`, { query: { locale }, key: `public-actor-${route.params.publicId}` })
if (error.value || !data.value?.profile) throw createError({ statusCode: 404, statusMessage: 'Public profile not found.' })
// /<username> is the profile's address when it is free; this one redirects there.
if (data.value.profile.path && data.value.profile.path !== route.path) {
  await navigateTo(data.value.profile.path, { redirectCode: 301, replace: true })
}
</script>
