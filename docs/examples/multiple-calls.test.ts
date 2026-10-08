// #region codec
import { Test, registerTest, relation } from 'hanamaru'

const encode = (value: string) => new TextEncoder().encode(value)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const input = 'こんにちは'

const codec = new Test()
  .target('codecの往復関係', relation({ encode, decode }))
  .it('元の値に戻る', t => t
    .calls(c => {
      const encoded = c.encode.args(input)
      return c.decode.args(encoded)
    })
    .expect(e => [e.result.toBe(input)]))

registerTest(codec)
// #endregion codec

// #region keys
const relationKey = (from: string, to: string) => JSON.stringify([from, to])

const keys = new Test()
  .target(relationKey)
  .it('異なる組み合わせを区別する', t => t
    .calls(c => ({
      first: c.args('ab', 'c'),
      second: c.args('a', 'bc'),
    }))
    .expect(e => [
      e.result.toSatisfy(({ first, second }) => first !== second),
    ]))

registerTest(keys)
// #endregion keys

const single = new Test()
  // #region single
  .target(relationKey)
  .it('二つの値からキーを作る', t => t
    .args('ab', 'c')
    .expect(e => [e.result.toBe('["ab","c"]')]))
  // #endregion single

registerTest(single)
