import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const testFile = /\.(test|spec)\.[cm]?[jt]s$/

export function createSourceLocation(implementationRoot: string) {
  return function location() {
    const lines = new Error().stack?.split('\n').slice(1) ?? []
    for (const line of lines) {
      const match = line.match(/(?:\(|at )((?:file:\/\/)?[^():]+):(\d+)(?::(\d+))?\)?$/)
      if (!match) continue
      let file = match[1]
      if (file.startsWith('file://')) file = fileURLToPath(file)
      // hanamaru自身の実装フレームは飛ばすが、実装と同じ場所に置いたテストファイルは利用者側の宣言位置として扱う。
      const ownImplementation = file.startsWith(`${implementationRoot}/`) && !testFile.test(basename(file))
      if (ownImplementation || file.startsWith('node:')) continue
      // Bunは1列目のフレームを「file:line」と表示する。
      return { file: resolve(file), line: Number(match[2]), column: Number(match[3] ?? 1) }
    }
    throw new Error('Cannot determine declaration location')
  }
}
