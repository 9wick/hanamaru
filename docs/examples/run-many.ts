import { registerTest } from 'hanamaru'
import { addition } from './math.test.ts'
import { users } from './user.test.ts'

// #region accept
registerTest(addition)
registerTest(users)
// #endregion accept
