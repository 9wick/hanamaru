import type { CliOptions } from '../../application/collection/options.js'

export function parseArgs(argv: string[]) {
  const options: CliOptions = {},
    files: string[] = []
  const mapped: Record<
    string,
    'filter' | 'reporter' | 'config' | 'collectionTimeout' | 'shutdownGrace' | 'projects' | 'id'
  > = {
    '--id': 'id',
    '-t': 'filter',
    '--filter': 'filter',
    '-r': 'reporter',
    '--reporter': 'reporter',
    '-c': 'config',
    '--config': 'config',
    '--project': 'projects',
    '--collection-timeout': 'collectionTimeout',
    '--shutdown-grace': 'shutdownGrace',
  }
  for (let i = 0; i < argv.length; i++) {
    const word = argv[i]
    if (Object.hasOwn(mapped, word)) {
      const value = argv[++i]
      if (!value || value.startsWith('-')) throw new TypeError(`${word} requires a value`)
      const key = mapped[word]
      if (key === 'collectionTimeout' || key === 'shutdownGrace') options[key] = Number(value)
      else if (key === 'projects') (options.projects ??= []).push(value)
      else options[key] = value
    } else if (word === '--list') options.list = true
    else if (word === '--ci') options.ci = true
    else if (word === '--fail-on-flaky') options.failOnFlaky = true
    else if (word === '--no-color') options.noColor = true
    else if (word === '--help' || word === '-h') options.help = true
    else if (word === '--version' || word === '-v') options.version = true
    else if (word.startsWith('-')) throw new TypeError(`unknown option: ${word}`)
    else {
      const location = word.match(/^(.*\.[cm]?[jt]sx?):([1-9]\d*)$/)
      if (location) {
        if (options.location) throw new TypeError('only one declaration location can be selected')
        options.location = { file: location[1], line: Number(location[2]) }
        files.push(location[1])
      } else files.push(word)
    }
  }
  if (options.id && options.location) throw new TypeError('--id cannot be combined with a declaration location')
  if (options.list && (options.id || options.location || options.filter))
    throw new TypeError('--list cannot be combined with execution filters')
  if (options.projects?.length && files.length) throw new TypeError('--project cannot be combined with files')
  return { options, files }
}
