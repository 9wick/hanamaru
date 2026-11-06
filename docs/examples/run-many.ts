import { registerTest } from 'hanamaru'
import { addition } from './math.test.ts'
import { users } from './user.test.ts'

registerTest(addition)
registerTest(users)
