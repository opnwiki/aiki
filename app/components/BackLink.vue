<template>
  <NuxtLink :to="to" class="group inline-flex items-center gap-2 text-sm font-medium text-emerald-800">
    <span class="grid size-8 shrink-0 place-items-center rounded-full border border-emerald-700/30 bg-emerald-50 text-emerald-900 transition group-hover:border-emerald-800 group-hover:bg-emerald-900 group-hover:text-white">
      <UIcon name="i-lucide-chevron-left" class="size-4 rtl:-scale-x-100" aria-hidden="true" />
    </span>
    <span class="underline-offset-4 group-hover:underline"><slot /></span>
  </NuxtLink>
</template>

<script setup>
defineProps({
  to: { type: [String, Object], required: true },
})
</script>
