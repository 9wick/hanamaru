import { expect, expectTypeOf, test } from 'vite-plus/test'
import { Test, environment } from '@hanamaru/blueprint'
import { ObservationOwner, checkedState } from '@hanamaru/blueprint/model'
import type { State } from '@hanamaru/blueprint'
import { withMiddleware } from './middleware.js'

const sum = (a: number, b: number) => a + b

test('effectful environments supply typed fields and observation scope before target execution', async () => {
  const owner = new ObservationOwner()
  const log: string[] = []
  let token: State<() => number> | undefined
  const env = environment(async (_, scope, next) => {
    log.push('prepare')
    token = scope.state({ evidence: 'real-effect', read: () => 42 })
    try {
      return await next({ value: 42 })
    } finally {
      log.push('cleanup')
    }
  })
  const result = await withMiddleware(
    env,
    {},
    async (fields) => {
      log.push('body')
      return fields.value
    },
    undefined,
    undefined,
    undefined,
    owner,
  )
  expect(result).toBe(42)
  expect(log).toEqual(['prepare', 'body', 'cleanup'])
  expect(checkedState(token, owner).evidence).toBe('real-effect')
  owner.close()
  expect(() => checkedState(token, owner)).toThrow('completed')
  const suite = new Test()
    .target(sum)
    .effectful()
    .use(env)
    .it('sum', (t) => t.argsFrom((c) => [c.value, 1]).expect((e) => [e.result.toEqual(43)]))
  expectTypeOf(suite.blueprint().characteristic).toEqualTypeOf<'effectful'>()
  expect(suite.blueprint().steps[0]?.kind).toBe('environment')
})

test('scope issuance stops at next, while nested environments share the same owner', async () => {
  const owner = new ObservationOwner()
  const inner = environment(async (_, scope, next) =>
    next({ state: scope.state({ evidence: 'real-effect', read: () => 2 }) }),
  )
  const outer = environment(async (_, scope, next) => {
    const result = await next({ state: scope.state({ evidence: 'real-effect', read: () => 1 }) })
    expect(() => scope.state({ evidence: 'real-effect', read: () => 3 })).toThrow('before next')
    return result
  })
  const ids: number[] = []
  await withMiddleware(
    outer,
    {},
    async (fields) => {
      ids.push(checkedState(fields.state, owner).id)
      await withMiddleware(
        inner,
        fields,
        async (nextFields) => {
          ids.push(checkedState(nextFields.state, owner).id)
        },
        undefined,
        undefined,
        undefined,
        owner,
      )
    },
    undefined,
    undefined,
    undefined,
    owner,
  )
  expect(new Set(ids).size).toBe(2)
  owner.close()
})

test('environment cannot run outside an evaluation', async () => {
  let invoked = false
  const env = environment(async (_, _scope, next) => {
    invoked = true
    return next()
  })
  await expect(withMiddleware(env, {}, async () => {})).rejects.toThrow('evaluation owner')
  expect(invoked).toBe(false)
})

test('pure and group builders reject an environment before invoking user code', () => {
  let invoked = false
  const env = environment(async (_, _scope, next) => {
    invoked = true
    return next()
  })
  const pure = new Test().target(sum)
  expectTypeOf(env).not.toExtend<Parameters<typeof pure.use>[0]>()
  const use: unknown = Reflect.get(pure, 'use')
  if (typeof use !== 'function') throw new Error('missing use method')
  expect(() => {
    Reflect.apply(use, pure, [env])
  }).toThrow('effectful')
  const root = new Test()
  const group: unknown = Reflect.get(root, 'group')
  if (typeof group !== 'function') throw new Error('missing group method')
  expect(() => {
    Reflect.apply(group, root, [env, []])
  }).toThrow('not environment')
  expect(invoked).toBe(false)
})
