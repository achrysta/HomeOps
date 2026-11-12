import { detailedCatalog } from '../lib/contentCatalog'
import { useStore as useBaseStore } from '../state/context'
export * from '../state/context'

/** Только lazy-экраны и карточки: их чанк загружает полные описания пакетов до рендера. */
export function useStore() {
  const store = useBaseStore()
  return { ...store, ...detailedCatalog(store.curriculum) }
}
