import { Test, registerTest, middleware } from 'hanamaru'
import { userRepository, mailService } from './user.ts'
import { userCases } from './user-cases.ts'

export const userCaseTests = new Test()
  .use(middleware(async (_, next) => next({ input: { name: 'Alice' }, expectedId: 'u1' })))
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group([userCases])

registerTest(userCaseTests)
