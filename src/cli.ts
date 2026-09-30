import { readFileSync } from 'node:fs'
import * as v from 'valibot'
import { errorMessage } from './foundation/errors.js'
import { superviseCollection } from './infrastructure/workers/supervisor.js'
import { runCommand } from './interfaces/cli/command.js'
const { version } = v.parse(
  v.object({ version: v.string() }),
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')),
)
const workerURL = new URL('./cli-worker.js', import.meta.url)
try {
  process.exitCode = await runCommand(process.argv.slice(2), version, (request, report) =>
    superviseCollection(workerURL, request, report),
  )
} catch (error) {
  process.stderr.write(`hanamaru: ${errorMessage(error)}\n`)
  process.exitCode = 2
}
