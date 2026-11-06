import { Test, middleware, environment, registerTest } from 'hanamaru'

export const lifecycle: string[] = []
export const service = {
  read(value: number) {
    return value * 2
  },
}
export const originalRead = service.read

const operations = new Test<{ label: string }>()
  .target((input: number, read: (n: number) => number, label: string) => ({
    values: [read(input), read(input + 1)],
    label,
  }))
  .effectful()
  .use(
    environment(async (_, _scope, next) => {
      lifecycle.push('attempt open')
      try {
        return await next({ input: 3, read: (n: number) => n + 4 })
      } finally {
        lifecycle.push('attempt close')
      }
    }),
  )
  .it('environment fake', (t) =>
    t
      .argsFrom((ctx) => [ctx.input, ctx.read, ctx.label])
      .expect((e) => [e.result.toEqual({ values: [7, 8], label: 'shared' })]),
  )
  .it('explicit dependency', (t) =>
    t
      .argsFrom((ctx) => [ctx.input, () => 9, ctx.label])
      .expect((e) => [e.result.toEqual({ values: [9, 9], label: 'shared' })]),
  )
  .skip('skipped', (t) =>
    t.args(1, (n) => n, 'shared').expect((e) => [e.result.toEqual({ values: [], label: 'shared' })]),
  )
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
