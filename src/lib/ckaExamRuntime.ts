/** Один набор действий на попытку в текущей вкладке, даже при смене страницы. */
const operations = new Set<string>()
const listeners = new Set<() => void>()
export function subscribeExamOperations(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export const examOperationBusy = (id: string): boolean => operations.has(id)
export function beginExamOperation(id: string): boolean {
  if (operations.has(id)) return false
  operations.add(id); listeners.forEach((listener) => listener()); return true
}
export function endExamOperation(id: string) { operations.delete(id); listeners.forEach((listener) => listener()) }
