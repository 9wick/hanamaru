import { run } from 'hanamaru'
import { addition } from './math.test.ts'
import { users } from './user.test.ts'

// #region accept
const result = await run(users)
const results = await run([addition, users])
// #endregion accept

console.log(result.status, results.status)
