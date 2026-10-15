import { Config, inject } from '@zeltjs/core'
import { ExecutionConnection } from '@hanamaru/runner/infrastructure/workers/execution-connection'
import { CollectionEnvironment } from './environment.js'
import { CollectionChannel } from './collection-channel.js'

@Config()
export class CollectionExecutionConnection extends ExecutionConnection {
  readonly port
  readonly #channel: CollectionChannel
  constructor(environment = inject(CollectionEnvironment), channel = inject(CollectionChannel)) {
    super()
    this.port = environment.executionPort
    this.#channel = channel
  }
  close(): Promise<void> {
    return this.#channel.closeExecution()
  }
}
