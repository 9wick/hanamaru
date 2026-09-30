import type { MutableRunResult } from '../../../domain/result/mutable.js'
export function formatJson(result: MutableRunResult): string {
  return JSON.stringify(result) + '\n'
}
