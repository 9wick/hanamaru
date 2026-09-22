import { Test } from 'hanamaru'
import { add } from './math.ts'

const addition = new Test()
  .target(add)
  .timeout(2_000)
  .it('足す', t => t
    .args(1, 2)
    .expect(e => [e.result.toBe(3)]))
  .it('再試行せず足す', t => t
    .timeout(500)
    .retry(0)
    .args(2, 3)
    .expect(e => [e.result.toBe(5)]))

export const tests = new Test()
  .timeout(5_000)
  .retry(2)
  .group(addition)
