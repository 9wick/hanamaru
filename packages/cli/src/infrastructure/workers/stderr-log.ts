import { Injectable } from '@zeltjs/core'

/**
 * workerが人へ向けて出す文字列の行き先。MessagePortはprotocolの通り道で、stdoutは親が結果表示に使うため、
 * 収集時の警告はstderrへ寄せる。
 */
@Injectable()
export class StderrLog {
  warn(message: string): void {
    process.stderr.write(message)
  }
}
