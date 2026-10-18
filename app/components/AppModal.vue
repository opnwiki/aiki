<template>
  <Teleport to="body">
    <Transition name="app-modal">
      <div
        v-if="open"
        class="fixed inset-0 z-[60] flex items-center justify-center bg-zinc-950/45 p-3 backdrop-blur-sm sm:p-6"
        data-testid="app-modal-backdrop"
        @click.self="emit('close')"
      >
        <section
          ref="dialog"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="labelledby"
          class="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 sm:rounded-3xl"
          data-testid="app-modal-dialog"
          @keydown="handleDialogKeydown"
        >
          <header v-if="title || description || showClose" class="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800 sm:px-7 sm:py-5">
            <div class="min-w-0">
              <h2 v-if="title" :id="labelledby" class="font-serif text-2xl font-normal text-zinc-950 dark:text-zinc-50">{{ title }}</h2>
              <p v-if="description" class="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-300">{{ description }}</p>
            </div>
            <button v-if="showClose" ref="closeButton" type="button" class="grid size-10 shrink-0 place-items-center rounded-full border border-zinc-200 text-xl text-zinc-600 hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800" :aria-label="closeLabel" @click="emit('close')">×</button>
          </header>
          <div class="min-h-0 overflow-y-auto p-5 sm:p-7">
            <slot />
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
const props = defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  description: { type: String, default: '' },
  closeLabel: { type: String, default: 'Close' },
  labelledby: { type: String, default: 'app-modal-title' },
  showClose: { type: Boolean, default: true },
})
const emit = defineEmits(['close'])
const dialog = ref(null)
const closeButton = ref(null)
const previousActive = ref(null)

watch(() => props.open, async (value) => {
  if (typeof document === 'undefined') return
  if (value) {
    previousActive.value = document.activeElement
    document.body.classList.add('app-modal-open')
    await nextTick()
    closeButton.value?.focus()
  } else {
    document.body.classList.remove('app-modal-open')
    await nextTick()
    previousActive.value?.focus?.()
  }
})

onMounted(() => window.addEventListener('keydown', handleWindowKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleWindowKeydown)
  document.body.classList.remove('app-modal-open')
})

function handleWindowKeydown(event) {
  if (props.open && event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}

function handleDialogKeydown(event) {
  if (event.key !== 'Tab') return
  const items = [...dialog.value.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
  if (!items.length) {
    event.preventDefault()
    closeButton.value?.focus()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && (document.activeElement === first || !dialog.value.contains(document.activeElement))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (document.activeElement === last || !dialog.value.contains(document.activeElement))) {
    event.preventDefault()
    first.focus()
  }
}
</script>
