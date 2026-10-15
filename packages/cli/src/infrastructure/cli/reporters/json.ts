import type { MutableRunResult } from '@hanamaru/runner/domain/result/mutable'
export function formatJson(result: MutableRunResult): string {
  return JSON.stringify(result) + '\n'
}
