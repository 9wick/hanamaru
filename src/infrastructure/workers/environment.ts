import { Config } from '@zeltjs/core'
import type { MessagePort } from 'node:worker_threads'

/**
 * 収集workerが起動時に受け取る環境。CLIへの通り道と実行workerへの通り道を親から受け取る。
 * runごとに変わる入力はここに持ち込まない。
 */
@Config({ abstract: true })
export abstract class CollectionEnvironment {
  abstract readonly port: MessagePort
  abstract readonly executionPort: MessagePort
}

/** 実行workerが起動時に受け取る環境。 */
@Config({ abstract: true })
export abstract class ExecutionEnvironment {
  abstract readonly port: MessagePort
}

/** CLIの親プロセスが起動時に受け取る環境。両workerの在りかは配布物の階層で決まる。 */
@Config({ abstract: true })
export abstract class CliEnvironment {
  abstract readonly collectionWorkerURL: URL
  abstract readonly executionWorkerURL: URL
}
