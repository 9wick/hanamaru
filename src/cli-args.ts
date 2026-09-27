import type { CliOptions } from './internal.js'

export function parseArgs(argv: string[]) {
  const options: CliOptions = {},
    files: string[] = []
  const mapped: Record<string, 'filter' | 'reporter' | 'config' | 'collectionTimeout' | 'shutdownGrace'> = {
    '-t': 'filter',
    '--filter': 'filter',
    '-r': 'reporter',
    '--reporter': 'reporter',
    '-c': 'config',
    '--config': 'config',
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
      else options[key] = value
    } else if (word === '--ci') options.ci = true
    else if (word === '--fail-on-flaky') options.failOnFlaky = true
    else if (word === '--no-color') options.noColor = true
    else if (word === '--help' || word === '-h') options.help = true
    else if (word === '--version' || word === '-v') options.version = true
    else if (word.startsWith('-')) throw new TypeError(`unknown option: ${word}`)
    else files.push(word)
  }
  return { options, files }
}
