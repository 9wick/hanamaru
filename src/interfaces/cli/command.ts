import type { CollectionRunner } from '../../application/ports/collection-runner.js'
import { parseArgs } from './args.js'
import { formatJson } from './reporters/json.js'
import { formatNode } from './reporters/pretty.js'
export async function runCommand(argv: string[], version: string, run: CollectionRunner): Promise<number> {
  const { options, files } = parseArgs(argv)
  if (options.version) {
    process.stdout.write(`${version}\n`)
    return 0
  }
  if (options.help) {
    process.stdout.write(
      'hanamaru [files...] [--project name] [--filter text] [--reporter pretty|json] [--config file] [--ci] [--fail-on-flaky] [--collection-timeout ms] [--shutdown-grace ms]\n',
    )
    return 0
  }

  return run({ options, files }, (result, reporter) => {
    if (reporter === 'json') process.stdout.write(formatJson(result))
    else
      process.stdout.write(
        result.tests
          .flatMap((node) => [
            ...(node.source
              ? [`${node.source.file}${node.source.projects.length ? ` [${node.source.projects.join(', ')}]` : ''}`]
              : []),
            ...formatNode(node),
          ])
          .join('\n') + '\n',
      )
  })
}
