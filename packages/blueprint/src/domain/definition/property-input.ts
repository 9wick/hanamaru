import type { Arbitrary, Generation } from './generation.js'
import { fixedGeneration, generationOf, generationVersion } from './generation.js'

export interface PropertyOptions {
  readonly seed?: number
  readonly runs?: number
  readonly maxShrinks?: number
}

/** 候補生成の設定。seedの省略値は実行器が決め、実行結果へ記録する。 */
export interface PropertyInput {
  readonly kind: 'generated'
  readonly source: Generation & { readonly kind: 'tuple' }
  readonly classification: 'fixed' | 'generated'
  readonly version: number
  readonly seed: number | undefined
  readonly runs: number
  readonly maxShrinks: number
}

function count(value: number, minimum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < minimum)
    throw new TypeError(`${name} must be a safe integer >= ${minimum}`)
  return value
}

export function propertyInput(source: Arbitrary, options: PropertyOptions = {}): PropertyInput {
  const node = generationOf(source)
  if (node.kind !== 'tuple') throw new TypeError('forAll requires tuples() as its input source')
  if (options.seed !== undefined && !Number.isSafeInteger(options.seed))
    throw new TypeError('seed must be a safe integer')
  const fixed = fixedGeneration(node)
  return Object.freeze({
    kind: 'generated',
    source: node,
    classification: fixed ? 'fixed' : 'generated',
    version: generationVersion,
    seed: options.seed,
    runs: count(options.runs ?? (fixed ? 1 : 100), 1, 'runs'),
    maxShrinks: count(options.maxShrinks ?? 1000, 0, 'maxShrinks'),
  })
}
