import { run } from 'hanamaru'
import { users } from './user.test.ts'

// プラグインは実行前の構造を参照できる。
export const blueprint = users.blueprint()

// 通常の実行では完成したテストをそのまま渡す。
export async function execute() {
  return run(users)
}
