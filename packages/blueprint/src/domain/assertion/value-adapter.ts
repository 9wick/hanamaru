import type { Value } from '../definition/javascript.js'
import { copyData } from '../definition/data-copy.js'

declare const adapterType: unique symbol
export interface ValueAdapter<T extends object> {
  readonly kind: 'value-adapter'
  readonly [adapterType]: (input: T) => void
}

class Adapter<T extends object> implements ValueAdapter<T> {
  readonly kind = 'value-adapter'
  declare readonly [adapterType]: (input: T) => void
  readonly #ctor: object
  readonly #capture: (value: Value) => Value
  constructor(ctor: abstract new (...args: never[]) => T, project: (value: T) => Value) {
    this.#ctor = ctor
    this.#capture = (value) => {
      if (!(value instanceof ctor)) throw new TypeError('valueAdapter received a value of another type')
      return copyData(project(value))
    }
    Object.freeze(this)
  }
  static type(adapter: object): object {
    if (!(adapter instanceof Adapter)) throw new TypeError('expected valueAdapter()')
    return adapter.#ctor
  }
  static capture(adapter: object, value: Value): Value {
    if (!(adapter instanceof Adapter)) throw new TypeError('expected valueAdapter()')
    return adapter.#capture(value)
  }
}

export function valueAdapter<T extends object>(
  ctor: abstract new (...args: never[]) => T,
  project: (value: T) => Value,
): ValueAdapter<T> {
  if (typeof ctor !== 'function' || typeof project !== 'function')
    throw new TypeError('valueAdapter requires a type and capture function')
  return new Adapter(ctor, project)
}
export const captureAdaptedValue = Adapter.capture

export const adapterTypeOf = Adapter.type
