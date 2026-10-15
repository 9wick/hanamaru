import { Config } from '@zeltjs/core'

/** CLIの親プロセスが起動時に受け取る環境。両workerの在りかは配布物の階層で決まる。 */
@Config({ abstract: true })
export abstract class CliEnvironment {
  abstract readonly collectionWorkerURL: URL
  abstract readonly executionWorkerURL: URL
}
