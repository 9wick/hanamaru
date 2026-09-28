import { Test, middleware, registerTest } from 'hanamaru'

export const lifecycle: string[] = []
export const service = {
  read(value: number) {
    return value * 2
  },
}
export const originalRead = service.read

const operations = new Test<{ label: string }>()
  .use(
    middleware(async (_, next) => {
      lifecycle.push('attempt open')
      try {
        return await next({ input: 3 })
      } finally {
        lifecycle.push('attempt close')
      }
    }),
  )
  .mock(service, 'read', (m) => m.returnsOnce(7).returns(8))
  .target((input: number) => [service.read(input), service.read(input + 1)])
  .it('mock sequence', (t) =>
    t
      .argsFrom((ctx) => [ctx.input])
      .expect((e) => [e.result.toEqual([7, 8]), e.result.toSatisfy(() => e.ctx.label === 'shared')])
      .expectCalls((call) => [call(service, 'read').calledTimes(2), call(service, 'read').calledNthWith(2, 4)]),
  )
  .it('case override', (t) =>
    t
      .mock(service, 'read', (m) => m.returns(9))
      .argsFrom((ctx) => [ctx.input])
      .expect((e) => [e.result.toEqual([9, 9])])
      .expectCalls((call) => [call(service, 'read').calledNthWith(1, 3)]),
  )
  .skip('skipped', (t) => t.args(1).expect((e) => [e.result.toEqual([])]))
  .todo('todo')

const rows = new Test()
  .target((a: number, b: number) => a + b)
  .each(
    'addition',
    [
      { a: 1, b: 2, expected: 3 },
      { a: 2, b: 3, expected: 5 },
    ],
    (t, row) => t.args(row.a, row.b).expect((e) => [e.result.toBe(row.expected)]),
  )

const provider = middleware(async (_, next) => {
  lifecycle.push('group open')
  try {
    return await next({ label: 'shared' })
  } finally {
    lifecycle.push('group close')
  }
})

export const contracts = new Test().group('contracts', [new Test().group(provider, [operations, rows])])
registerTest(contracts)
