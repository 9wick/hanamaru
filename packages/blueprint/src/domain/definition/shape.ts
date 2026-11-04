import type { RuntimeArgs, RuntimeTarget } from './runtime.js'
import { MethodOperation } from './scenario.js'
import { captureValue } from '../assertion/value-image.js'
import type { Value } from './javascript.js'
import { valueOf } from './javascript.js'

function source(value: object | null): string | null {
  if (value === null) return null
  if (typeof value !== 'function') throw new TypeError('definition callback must be a function')
  return Function.prototype.toString.call(value)
}
function dataShape(value: Value): string {
  const image = captureValue(value)
  const symbols = new Map<symbol, number>()
  return JSON.stringify(
    {
      root: image.root,
      nodes: Array.from(image.nodes, ([id, node]) => {
        const ctor =
          node.prototype === null
            ? null
            : valueOf(Object.getOwnPropertyDescriptor(node.prototype, 'constructor')?.value)
        return {
          id,
          prototype: typeof ctor === 'function' ? source(ctor) : null,
          properties: Array.from(node.properties),
          payload: node.payload,
        }
      }),
    },
    (_key: string, value: unknown) => {
      if (typeof value === 'bigint') return { bigint: String(value) }
      if (typeof value === 'symbol') {
        const id = symbols.get(value) ?? symbols.size
        symbols.set(value, id)
        return { symbol: id, description: value.description }
      }
      if (typeof value === 'number' && (!Number.isFinite(value) || Object.is(value, -0)))
        return { number: Object.is(value, -0) ? '-0' : String(value) }
      if (value === undefined) return { undefined: true }
      return value
    },
  )
}

/** 定義の照合用情報。from・steps・生成器・期待ビルダーを実行しない。 */
export function targetShape(target: RuntimeTarget): object {
  switch (target.kind) {
    case 'function':
      return { kind: target.kind, source: source(target.fn) }
    case 'method':
      return { kind: target.kind, key: target.key, source: source(target.fn) }
    case 'instance':
      return { kind: target.kind, key: target.key, ctor: source(target.ctor), from: source(target.from) }
    case 'scenario':
      return {
        kind: target.kind,
        from: source(target.from),
        members: Object.entries(target.members).map(([key, member]) =>
          member instanceof MethodOperation
            ? { key, method: member.key, ctor: source(member.ctor) }
            : { key, source: source(member) },
        ),
      }
  }
}
export function inputShape(args: RuntimeArgs): object {
  switch (args.kind) {
    case 'value':
      return { kind: args.kind, length: args.value.length }
    case 'from-context':
    case 'steps':
      return { kind: args.kind, source: source(args.build) }
    case 'generated':
      return {
        kind: args.kind,
        input: { ...args.input, source: dataShape(args.input.source) },
        binding:
          args.binding.kind === 'sample'
            ? { kind: 'sample' }
            : { kind: args.binding.kind, source: source(args.binding.build) },
      }
  }
}
