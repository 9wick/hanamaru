import type { MessagePort } from 'node:worker_threads'
import type { CliOptions } from '../../application/collection/options.js'

export interface CliWorkerData {
  files: string[]
  options: CliOptions
  executionPort: MessagePort
}

export type { CliMessage, Reporter } from '../../application/collection/events.js'
