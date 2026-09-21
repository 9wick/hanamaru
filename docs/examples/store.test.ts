import { storeContract } from './store.contract.ts'
import { memoryStore, objectStore } from './store.ts'

export const memory = storeContract(memoryStore, {
  file: 'src/store.ts', exportName: 'memoryStore',
})
export const object = storeContract(objectStore, {
  file: 'src/store.ts', exportName: 'objectStore',
})
