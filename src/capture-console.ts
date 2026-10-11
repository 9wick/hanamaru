import type { Value } from '@hanamaru/blueprint/model'

const consoleMethods: ('log' | 'info' | 'warn' | 'error' | 'debug')[] = ['log', 'info', 'warn', 'error', 'debug']

/**
 * テスト本体のconsole出力が親の結果表示へ混ざらないようにする。
 * 読み込んだコードが最初の1行を出す前に差し替える必要があるため、入口が他の組み立てより先に呼ぶ。
 */
export function captureConsole(): void {
  for (const method of consoleMethods)
    console[method] = (...values: Value[]) => process.stderr.write(values.map(String).join(' ') + '\n')
}
