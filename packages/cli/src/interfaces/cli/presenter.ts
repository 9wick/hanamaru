import type { TargetCatalogue } from '@hanamaru/runner/domain/execution/targets'
import { Config } from '@zeltjs/core'
import type { MutableRunResult } from '@hanamaru/runner/domain/result/mutable'
import { ResultPresenter } from '../../application/ports/collection-runner.js'
import { formatJson } from './reporters/json.js'
import { formatNode, formatResources } from './reporters/pretty.js'

/** 結果の表示先。workerはstderrを使うため、親が人へ見せる結果だけがstdoutへ出る。 */
@Config()
export class StdoutPresenter extends ResultPresenter {
  override catalogue(catalogue: TargetCatalogue, reporter: string | undefined): void {
    process.stdout.write(
      reporter === 'json'
        ? JSON.stringify(catalogue) + '\n'
        : catalogue.cases
            .map((target) => target.id + ' ' + target.name + ' (' + target.origin.file + ':' + target.origin.line + ')')
            .join('\n') + '\n',
    )
  }
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
