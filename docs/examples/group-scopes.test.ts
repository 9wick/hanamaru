import { Test } from 'hanamaru'
import { add } from './math.ts'
import { createUser, userRepository, mailService } from './user.ts'

function subtract(a: number, b: number): number {
  return a - b
}

const addition = new Test()
  .target(add)
  .it('2つの数を足す', t => t.args(1, 2).expect(e => [e.result.toBe(3)]))

const subtraction = new Test()
  .target(subtract)
  .it('2つの数を引く', t => t.args(3, 1).expect(e => [e.result.toBe(2)]))

const createTests = new Test()
  .target(createUser)
  .it('ユーザーを作る', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'u1' })]))

const saveTests = new Test()
  .target(userRepository, 'save')
  .it('ユーザーを保存する', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'u1' })]))

const mailTests = new Test()
  .target(mailService, 'send')
  .it('通知を送る', t => t
    .args({ id: 'u1' })
    .expect(e => [e.result.toBe(undefined)]))

// #region names
const grouped = new Test()
  .group('基本', [addition, subtraction])
  .group('再確認', [addition])
// #endregion names

// #region nesting
const inner = new Test().group('内側', [addition])
const outer = new Test().group('外側', [inner])
// #endregion nesting

// #region scoped-mock
// #region group
const userGroup = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group('ユーザー', [createTests, saveTests])
// #endregion group

const scoped = new Test()
  .group([userGroup])
  .group('メール', [mailTests])
// #endregion scoped-mock

export const groupScopes = new Test().group([grouped, outer, scoped])
