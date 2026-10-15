import { users } from './user.test.ts'

// #region blueprint
const blueprint = users.blueprint()
// #endregion blueprint
console.log(blueprint.kind, blueprint.version)
