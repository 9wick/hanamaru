import { run } from 'hanamaru'
import { users } from './user.test.ts'

// 取得するのは、実行に必要な構造を持つ計画そのもの。
export const plan = users.plan()

// 計画を得ても実行は始まらない。
export async function execute() {
  return run(plan)
}
