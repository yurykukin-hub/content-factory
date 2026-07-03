import { ref, onMounted, onUnmounted } from 'vue'

export function useBreakpoint() {
  const isMobile = ref(false)
  const isTablet = ref(false)
  const isDesktop = ref(true)

  let mobileQuery: MediaQueryList | null = null
  let tabletQuery: MediaQueryList | null = null

  function update() {
    isMobile.value = mobileQuery?.matches ?? false
    isTablet.value = (tabletQuery?.matches ?? false) && !isMobile.value
    isDesktop.value = !isMobile.value && !isTablet.value
  }

  onMounted(() => {
    mobileQuery = window.matchMedia('(max-width: 767px)')
    tabletQuery = window.matchMedia('(max-width: 1023px)')
    update()
    mobileQuery.addEventListener('change', update)
    tabletQuery.addEventListener('change', update)
  })

  onUnmounted(() => {
    mobileQuery?.removeEventListener('change', update)
    tabletQuery?.removeEventListener('change', update)
  })

  return { isMobile, isTablet, isDesktop }
}
