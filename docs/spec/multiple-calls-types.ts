import { Test, registerTest, scenario, tuples, constant } from 'hanamaru'
import type { CallRef, TestDefinition } from 'hanamaru'

const encode = async (value: string) => new TextEncoder().encode(value)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const codec = new Test().target('codec', scenario({ encode, decode }))
const suite = codec.it('round trip', t => t.steps(c => {
  const encoded: CallRef<Uint8Array> = c.encode.args('こんにちは')
  return c.decode.args(encoded)
}).expect(e => [e.result.toBe('こんにちは')]))
const definition: TestDefinition = suite
registerTest(definition)
registerTest(new Test().group([suite]))

const key = (from: string, to: string) => JSON.stringify([from, to])
new Test().target(key).property('keys', p => p.forAll(tuples(constant('ab'), constant('c')))
  .steps(s => ({ first: s.target.args(s.input[0], s.input[1]), second: s.target.args('a', 'bc') }))
  .expect(e => [e.on(e.result).satisfies('different pairs', ({ first, second }) => first !== second)]))
new Test().target((...values: number[]) => values.length).it('rest', t => t.args(1, 2).expect(e => [e.result.toEqual(2)]))
new Test().target((n?: number) => n).it('optional', t => t.args().expect(e => [e.result.toEqual(undefined)]))

// @ts-expect-error a scenario requires at least one named function.
scenario({})
// @ts-expect-error scenario participants must be functions.
scenario({ encode, invalid: 1 })
// @ts-expect-error scenarios require steps instead of shared args.
codec.it('args', t => t.args('x'))
// @ts-expect-error only declared scenario members are available.
codec.it('unknown', t => t.steps(c => c.other.args('x')))
// @ts-expect-error an arbitrary function cannot be introduced inside steps.
codec.it('arbitrary', t => t.steps(c => c.call(decode)))
// @ts-expect-error argument types are taken from the participant function.
codec.it('type', t => t.steps(c => c.encode.args(1)))
// @ts-expect-error argument count is taken from the participant function.
codec.it('arity', t => t.steps(c => c.encode.args()))
// @ts-expect-error a string result reference cannot satisfy a Uint8Array argument.
codec.it('wrong dependency', t => t.steps(c => c.decode.args(c.decode.args(new Uint8Array()))))
// @ts-expect-error a steps callback must be synchronous.
codec.it('async', t => t.steps(async c => c.encode.args('x')))
// @ts-expect-error steps must return at least one reference.
codec.it('empty', t => t.steps(() => ({})))
// @ts-expect-error steps must return references rather than actual values.
codec.it('value', t => t.steps(() => 'x'))
// @ts-expect-error named outputs contain references rather than actual values.
codec.it('named value', t => t.steps(c => ({ encoded: c.encode.args('x'), invalid: 1 })))
// @ts-expect-error args and steps are mutually exclusive stages.
new Test().target(key).it('mix', t => t.args('a', 'b').steps(c => c.args('a', 'b')))
// @ts-expect-error steps and args are mutually exclusive stages.
new Test().target(key).property('mix', p => p.forAll(tuples(constant('a'), constant('b'))).steps(s => s.target.args('a', 'b')).argsFrom(() => ['a', 'b']))
// @ts-expect-error the result matcher retains the awaited result type.
codec.it('result', t => t.steps(c => c.decode.args(new Uint8Array())).expect(e => [e.result.toBe(1)]))
// @ts-expect-error multi-call exception assertions are outside the normal-result contract.
codec.it('error', t => t.steps(c => c.encode.args('x')).expect(e => [e.error.message.toEqual('x')]))
// @ts-expect-error named outputs retain each result type.
codec.it('record', t => t.steps(c => ({ value: c.decode.args(new Uint8Array()) })).expect(e => [e.result.toEqual({ value: 1 })]))

const failing = (value: string) => { if (!value) throw new Error('empty'); return value }
new Test().target(failing).property('final', p => p.forAll(tuples(constant('')))
  .steps(s => s.target.final(s.input[0])).expect(e => [e.error.message.toEqual('empty')]))
new Test().target(failing).property('mixed exits', p => p.forAll(tuples(constant('')))
  .steps(s => s.target.final(s.input[0])).expect(e => [e.on(e.outcome.withError(Error)).satisfies('known exit', exit => exit.kind === 'return' || exit.error === null)]))
// @ts-expect-error final references cannot supply a later operation argument.
new Test().target(failing).property('final input', p => p.forAll(tuples()).steps(s => s.target.args(s.target.final(''))))
// @ts-expect-error final references do not expose fields.
new Test().target(failing).property('final field', p => p.forAll(tuples()).steps(s => s.target.final('').field('length')))
// @ts-expect-error input belongs to single execution, not a steps plan.
new Test().target(failing).property('no input ref', p => p.forAll(tuples()).steps(s => s.target.args('')).expect(e => [e.on(e.input(0)).satisfies('empty', v => v === '')]))
