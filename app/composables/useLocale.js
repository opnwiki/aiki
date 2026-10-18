import { languages, translate } from '~/utils/i18n'

const supportedCodes = new Set(languages.map(language => language.code))

function normalizeLocale(raw) {
  if (!raw) return null
  const code = raw.trim().split('-')[0].toLowerCase()
  return supportedCodes.has(code) ? code : null
}

function detectedLocale() {
  if (process.client && typeof navigator !== 'undefined') {
    const raw = navigator.language || (navigator.languages && navigator.languages[0])
    return normalizeLocale(raw)
  }
  return null
}

export function useLocale() {
  const localeCookie = useCookie('aiki-locale', { sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  const explicitLocaleCookie = useCookie('aiki-locale-explicit', { sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
  // Keep the SSR and hydration values identical. Browser language detection
  // happens after mount when there is no saved preference yet.
  const initialLocale = normalizeLocale(localeCookie.value) || 'en'
  const locale = computed({
    get: () => {
      if (localeCookie.value && supportedCodes.has(localeCookie.value)) return localeCookie.value
      return initialLocale
    },
    set: (value) => {
      if (supportedCodes.has(value)) localeCookie.value = value
    },
  })

  function setLocale(value) {
    if (!supportedCodes.has(value)) return
    locale.value = value
    // Browser detection is only a default. A choice in the language picker is
    // an explicit request to translate page content as well as the UI.
    explicitLocaleCookie.value = '1'
  }

  onMounted(() => {
    if (!localeCookie.value) {
      const preferred = detectedLocale()
      if (preferred) localeCookie.value = preferred
    }
  })

  const t = (key, params) => translate(locale.value, key, params)
  const language = computed(() => languages.find(item => item.code === locale.value) || languages[0])

  return { locale, language, languages, t, setLocale }
}
