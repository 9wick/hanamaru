import { Test, registerTest, middleware } from 'hanamaru'
import { userCases } from './user-cases.ts'
export const userCaseTests = new Test()
  .group(middleware(async (_, next) => next({ input: { name: 'Alice' }, expectedId: 'u1' })), [userCases])
registerTest(userCaseTests)
