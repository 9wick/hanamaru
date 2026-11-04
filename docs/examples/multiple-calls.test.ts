import { Test, registerTest, scenario, tuples, constant } from 'hanamaru'

const encode = (value: string) => new TextEncoder().encode(value)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const input = 'こんにちは'

const codec = new Test()
  .target('codecの往復関係', scenario({ encode, decode }))
  .it('元の値に戻る', t => t
    .steps(c => {
      const encoded = c.encode.args(input)
      return c.decode.args(encoded)
    })
    .expect(e => [e.result.toBe(input)]))

registerTest(codec)

const relationKey = (from: string, to: string) => JSON.stringify([from, to])

const keys = new Test()
  .target(relationKey)
  .property('異なる組み合わせを区別する', p => p
    .forAll(tuples(constant('ab'), constant('c')))
    .steps(s => ({ first: s.target.args(s.input[0], s.input[1]), second: s.target.args('a', 'bc') }))
    .expect(e => [
      e.on(e.result).satisfies('異なる組を区別する', ({ first, second }) => first !== second),
    ]))

registerTest(keys)

const single = new Test()
  .target(relationKey)
  .it('二つの値からキーを作る', t => t
    .args('ab', 'c')
    .expect(e => [e.result.toBe('["ab","c"]')]))

registerTest(single)
