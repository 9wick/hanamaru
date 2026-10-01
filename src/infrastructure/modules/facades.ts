import { Injectable, inject } from '@zeltjs/core'
import type { ModulePreparation } from '../../application/ports/module-loader.js'
import type { AnyFn } from '../../foundation/functions.js'
import type { Value } from '../../foundation/value.js'
import {
  arrayValue,
  fieldsValue,
  functionValue,
  invoke as invokeFunction,
  objectValue,
  property,
  required,
  valueOf,
} from '../../foundation/value.js'
import { ModuleRegistry } from './reference.js'

/** test runtimeが読み込んだmoduleのexport一式。 */
export type Namespace = Record<PropertyKey, Value>

/** 差し替えを受ける1つのmoduleの台。差し替え先の値と、呼び出しを振り分ける関数をexportごとに持つ。 */
interface ModuleSlot {
  keys: Set<PropertyKey>
  values: Namespace
  dispatchers: Map<PropertyKey, AnyFn>
}

/**
 * 読み込んだmoduleに被せるnamespaceを作り、差し替えの台帳を抱える。
 * 保存済みの参照からも差し替えが見えるよう、exportごとの振り分け役は1度だけ作って使い回す。
 */
@Injectable()
export class ModuleFacades {
  readonly #registry: ModuleRegistry
  readonly #slots = new Map<string, ModuleSlot>()
  readonly #views = new WeakMap<object, Namespace>()

  constructor(registry = inject(ModuleRegistry)) {
    this.#registry = registry
  }

  /** 差し替える宛先は収集の途中で決まるため、moduleを読み込む前に台を据える。 */
  prepare(preparation: ModulePreparation[]): void {
    for (const { id, keys } of preparation)
      this.#slots.set(id, {
        keys: new Set<PropertyKey>(keys),
        values: fieldsValue(Object.create(null)),
        dispatchers: new Map<PropertyKey, AnyFn>(),
      })
  }

  view<T>(id: string, input: T): Namespace {
    const original = objectValue(valueOf(input))
    if (this.#views.has(original)) return required(this.#views.get(original))
    const slot = this.#slots.get(id)
    const facade: Namespace = new Proxy(fieldsValue(Object.create(null)), {
      get(_, key) {
        if (!slot?.keys.has(key)) return property(original, key)
        if (!slot.dispatchers.has(key)) {
          const target = property(original, key)
          if (typeof target !== 'function') return target
          const callOriginal = function (this: Value, ...args: Value[]) {
            return invokeFunction(objectValue(property(original, key)), this, args)
          }
          Object.defineProperty(slot.values, key, {
            value: callOriginal,
            writable: true,
            enumerable: true,
            configurable: true,
          })
          const dispatch: AnyFn = new Proxy(functionValue(target), {
            apply: (_, receiver, args) =>
              invokeFunction(objectValue(slot.values[key]), valueOf(receiver), arrayValue(args)),
            construct(_, args, newTarget): object {
              const implementation = slot.values[key] === callOriginal ? property(original, key) : slot.values[key]
              return objectValue(
                valueOf(
                  Reflect.construct(
                    functionValue(implementation),
                    args,
                    functionValue(newTarget === dispatch ? implementation : newTarget),
                  ),
                ),
              )
            },
          })
          slot.dispatchers.set(key, dispatch)
        }
        return slot.dispatchers.get(key)
      },
      has: (_, key) => Reflect.has(original, key),
      ownKeys: () => Reflect.ownKeys(original),
      getOwnPropertyDescriptor(_, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(original, key)
        return (
          descriptor && { enumerable: descriptor.enumerable, configurable: true, writable: true, value: facade[key] }
        )
      },
      set: () => false,
      defineProperty: () => false,
      deleteProperty: () => false,
    })
    this.#views.set(original, facade)
    this.#views.set(facade, facade)
    this.#registry.register(facade, id)
    return facade
  }

  /** 差し替えの宛先を台へ繋ぎ替える。元のnamespaceは差し替え前の値を読むために残す。 */
  bind<T extends { object: object; key: string }>(entry: T): T & { sourceObject?: object } {
    const id = this.#registry.identify(entry.object)
    if (!id) return entry
    const slot = this.#slots.get(id)
    if (!slot?.keys.has(entry.key)) throw new Error(`unprepared module mock: ${id}#${entry.key}`)
    void Reflect.get(entry.object, entry.key)
    return { ...entry, object: slot.values, sourceObject: entry.object }
  }
}
