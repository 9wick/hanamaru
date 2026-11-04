import { users } from './user.test.ts'

const blueprint = users.blueprint()
console.log(blueprint.kind, blueprint.version)
