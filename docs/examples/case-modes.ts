import { Test } from 'hanamaru'
import { createUser, userRepository } from './user.ts'

// onlyを含むため、CLIの探索対象になる *.test.ts では置かない。
export const caseModes = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  // #region modes
  .it('保存する', t => t.args({ name: 'Alice' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
  .only('集中して確認する', t => t.args({ name: 'Bob' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
  .skip('修正待ち', t => t.args({ name: 'Carol' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
  .todo('送信失敗時の扱い')
// #endregion modes
