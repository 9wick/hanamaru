import type { MutableRunResult } from '../../domain/result/mutable.js'
import type { CliOptions } from '../collection/options.js'
export interface CollectionRequest {
  files: string[]
  options: CliOptions
}
export type ReportResult = (result: MutableRunResult, reporter: string | undefined) => void
export type CollectionRunner = (request: CollectionRequest, report: ReportResult) => Promise<number>
