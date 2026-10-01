import { Injectable } from '@zeltjs/core'
import { ProgressStore } from './progress.js'

/**
 * 部分結果ツリーをDIで配るための宛名。
 * CLIの親プロセスはProgressStoreを直に作って使うため、DIの宛名だけを別の置き場所へ分ける。
 */
@Injectable()
export class RunProgress extends ProgressStore {}
