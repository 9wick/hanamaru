import { storeContract } from './store.contract.ts'
import { memoryStore, objectStore } from './store.ts'

export const memory = storeContract(memoryStore)
export const object = storeContract(objectStore)
