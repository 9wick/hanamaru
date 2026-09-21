import { Test } from 'hanamaru'
import { userRepository, mailService } from './user.ts'
import { userCases } from './user-cases.ts'

const alice = new Test()
  .setup(() => ({ input: { name: 'Alice' }, expectedId: 'u1' }))
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .group(userCases)

const bob = new Test()
  .setup(() => ({ input: { name: 'Bob' }, expectedId: 'u2' }))
  .mock(userRepository, 'save', m => m.resolves({ id: 'u2' }))
  .group(userCases)

export const registrations = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group(alice)
  .group('Bobの登録', bob)
