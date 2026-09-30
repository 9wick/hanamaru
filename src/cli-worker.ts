import { startCollection } from './infrastructure/workers/collection.js'
startCollection(new URL('./index.js', import.meta.url), new URL('./execution-worker.js', import.meta.url))
