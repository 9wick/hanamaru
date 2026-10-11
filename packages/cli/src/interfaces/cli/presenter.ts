import { Config } from '@zeltjs/core'
import type { MutableRunResult } from '@hanamaru/execution/domain/result/mutable'
import { ResultPresenter } from '../../application/ports/collection-runner.js'
import { formatJson } from './reporters/json.js'
import { formatNode, formatResources } from './reporters/pretty.js'

/** 結果の表示先。workerはstderrを使うため、親が人へ見せる結果だけがstdoutへ出る。 */
@Config()
export class StdoutPresenter extends ResultPresenter {
  present(result: MutableRunResult, reporter: string | undefined): void {
    if (reporter === 'json') process.stdout.write(formatJson(result))
    else
      process.stdout.write(
        [
          ...formatResources(result.resources),
          ...result.tests.flatMap((node) => [
            ...(node.source
              ? [`${node.source.file}${node.source.projects.length ? ` [${node.source.projects.join(', ')}]` : ''}`]
              : []),
            ...formatNode(node),
          ]),
        ].join('\n') + '\n',
      )
  }
}
