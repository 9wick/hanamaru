import { Test, registerTest, tuples, integers } from 'hanamaru'
import { add } from './math.ts'
const values = new Test().target((a: number, b: number) => ({ sum: a + b }))
  .it('具体的な部分を照合する', t => t.args(0.1, 0.2).expect(e => [
    e.result.part('sum').toBeCloseTo(0.3, { absoluteTolerance: 1e-12 }),
  ]))
const positive = new Test().target(add)
  .property('正数同士の和は正', p => p.forAll(tuples(integers({ min: 1, max: 100 }), integers({ min: 1, max: 100 })))
    .expect(e => [e.on(e.result).satisfies('正である', sum => sum > 0)]))
const failing = new Test().target((message: string) => { throw new TypeError(message) })
  .it('具体的な例外を返す', t => t.args('invalid').expect(e => [e.error.ofType(TypeError).part('message').toEqual('invalid')]))
registerTest(new Test().group([values, positive, failing]))
