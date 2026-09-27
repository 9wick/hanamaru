// #region run
import { run } from 'hanamaru'
import { users } from './user.test.ts'

const result = await run(users)
// #endregion run
// #region blueprint
const blueprint = users.blueprint()
// #endregion blueprint
console.log(result.status, blueprint.kind)
