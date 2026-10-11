import type { MutableRunResult } from '@hanamaru/execution/domain/result/mutable'
export function formatJson(result: MutableRunResult): string {
  return JSON.stringify(result) + '\n'
}
