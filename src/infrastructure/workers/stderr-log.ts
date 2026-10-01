import { Config } from '@zeltjs/core'
import { Warnings } from '../../application/ports/collection-host.js'
import type { Value } from '../../foundation/value.js'

const consoleMethods: ('log' | 'info' | 'warn' | 'error' | 'debug')[] = ['log', 'info', 'warn', 'error', 'debug']

/**
 * テスト本体のconsole出力が親の結果表示へ混ざらないようにする。
 * 読み込んだコードが最初の1行を出す前に差し替える必要があるため、入口が他の組み立てより先に呼ぶ。
 */
export function captureConsole(): void {
  for (const method of consoleMethods)
    console[method] = (...values: Value[]) => process.stderr.write(values.map(String).join(' ') + '\n')
}

/**
 * workerが人へ向けて出す文字列の行き先。MessagePortはprotocolの通り道で、stdoutは親が結果表示に使うため、
 * 収集時の警告はstderrへ寄せる。
 */
@Config()
export class StderrLog extends Warnings {
  warn(message: string): void {
    process.stderr.write(message)
  }
}
