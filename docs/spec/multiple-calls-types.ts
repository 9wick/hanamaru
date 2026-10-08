import { Test, registerTest, relation, run } from 'hanamaru'
import type { CallRef, TestDefinition } from 'hanamaru'

const encode = async (value: string) => new TextEncoder().encode(value)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const codec = new Test().target('codec', relation({ encode, decode }))
const suite = codec.it('round trip', t => t.calls(c => {
  const encoded: CallRef<Uint8Array> = c.encode.args('こんにちは')
  return c.decode.args(encoded)
}).expect(e => [e.result.toBe('こんにちは')]))
const definition: TestDefinition = suite
registerTest(definition)
run(new Test().group([suite]))

const key = (from: string, to: string) => JSON.stringify([from, to])
new Test().target(key).it('keys', t => t.calls(c => ({ first: c.args('ab', 'c'), second: c.args('a', 'bc') }))
  .expect(e => [e.result.toSatisfy(({ first, second }) => first !== second)]))
new Test().target((...values: number[]) => values.length).it('rest', t => t.calls(c => c.args(1, 2)).expect(e => [e.result.toBe(2)]))
new Test().target((n?: number) => n).it('optional', t => t.calls(c => c.args()).expect(e => [e.result.toBe(undefined)]))

// @ts-expect-error a relation requires at least one named function.
relation({})
// @ts-expect-error relation participants must be functions.
relation({ encode, invalid: 1 })
// @ts-expect-error relations require calls instead of shared args.
codec.it('args', t => t.args('x'))
// @ts-expect-error only declared relation members are available.
codec.it('unknown', t => t.calls(c => c.other.args('x')))
// @ts-expect-error an arbitrary function cannot be introduced inside calls.
codec.it('arbitrary', t => t.calls(c => c.call(decode)))
// @ts-expect-error argument types are taken from the participant function.
codec.it('type', t => t.calls(c => c.encode.args(1)))
// @ts-expect-error argument count is taken from the participant function.
codec.it('arity', t => t.calls(c => c.encode.args()))
// @ts-expect-error a string result reference cannot satisfy a Uint8Array argument.
codec.it('wrong dependency', t => t.calls(c => c.decode.args(c.decode.args(new Uint8Array()))))
// @ts-expect-error a calls callback must be synchronous.
codec.it('async', t => t.calls(async c => c.encode.args('x')))
// @ts-expect-error calls must return at least one reference.
codec.it('empty', t => t.calls(() => ({})))
// @ts-expect-error calls must return references rather than actual values.
codec.it('value', t => t.calls(() => 'x'))
// @ts-expect-error named outputs contain references rather than actual values.
codec.it('named value', t => t.calls(c => ({ encoded: c.encode.args('x'), invalid: 1 })))
// @ts-expect-error args and calls are mutually exclusive stages.
new Test().target(key).it('mix', t => t.args('a', 'b').calls(c => c.args('a', 'b')))
// @ts-expect-error calls and args are mutually exclusive stages.
new Test().target(key).it('mix', t => t.calls(c => c.args('a', 'b')).args('a', 'b'))
// @ts-expect-error the result matcher retains the awaited result type.
codec.it('result', t => t.calls(c => c.decode.args(new Uint8Array())).expect(e => [e.result.toBe(1)]))
// @ts-expect-error multi-call exception assertions are outside the normal-result contract.
codec.it('error', t => t.calls(c => c.encode.args('x')).expect(e => [e.error.toThrow('x')]))
// @ts-expect-error named outputs retain each result type.
codec.it('record', t => t.calls(c => ({ value: c.decode.args(new Uint8Array()) })).expect(e => [e.result.toEqual({ value: 1 })]))
