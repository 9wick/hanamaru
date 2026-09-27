import { registrations } from './groups.test.ts'

const blueprint = registrations.blueprint()
for (const group of blueprint.children) {
  // このチェーンの各group呼び出し。group.nameとgroup.middlewareを取得できる。
  for (const entry of group.children) {
    const child = entry.blueprint
    if (child.kind === 'definition') {
      // 子チェーンの共通設定と、その中のgroup呼び出しを取得できる。
    } else if (child.kind === 'group') {
      // 子グループのsteps・mocks・childrenを取得できる。
    } else {
      // 対象ケース群のtarget・casesを取得できる。
    }
  }
}
