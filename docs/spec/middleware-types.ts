import { Test, run } from 'hanamaru'
interface Db { close(): Promise<void>; countUsers(): Promise<number> }
declare function createDb(): Promise<Db>
declare function countUsers(db: Db): Promise<number>
declare function expectType<T>(value: T): void

const configured = new Test()
  .setup(() => ({ expected: 3 }))
  .use(async (ctx, next) => {
    expectType<number>(ctx.expected)
    const db = await createDb()
    try {
      return await next({ db })
    } finally {
      await db.close()
    }
  })
  .use(async (ctx, next) => {
    expectType<Db>(ctx.db)
    expectType<number>(ctx.expected)
    return await next({ label: 'users' })
  })
  .use(async (ctx, next) => {
    expectType<string>(ctx.label)
    return await next()
  })

const suite = configured.target(countUsers)
  .it('ユーザー数', t => t
    .argsFrom(ctx => {
      expectType<Db>(ctx.db)
      expectType<number>(ctx.expected)
      expectType<string>(ctx.label)
      // @ts-expect-error fields do not degrade to any.
      expectType<string>(ctx.expected)
      // @ts-expect-error unprovided fields remain unavailable.
      ctx.missing
      return [ctx.db]
    })
    .expect(e => {
      expectType<Db>(e.ctx.db)
      expectType<number>(e.ctx.expected)
      return [e.result.toBe(e.ctx.expected)]
    }))
run(suite.plan())
// @ts-expect-error middleware cannot change the context after a case is declared.
suite.use(async (_, next) => next({ extra: true }))
// @ts-expect-error middleware output must be returned to retain its inferred type.
new Test().use(async (_, next) => { await next({ db: await createDb() }) })

const child = new Test<{ db: Db; expected: number }>()
  .target(countUsers)
  .it('親から受け取る', t => t.argsFrom(ctx => [ctx.db])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
run(configured.group(child).plan())
// @ts-expect-error a missing middleware cannot supply the child's required fields.
new Test().group(child)
// @ts-expect-error incomplete middleware output cannot satisfy all the requirements.
new Test().use(async (_, next) => next({ db: await createDb() })).group(child)
// @ts-expect-error the child still cannot run without its parent.
run(child.plan())

new Test().target(countUsers)
  .use(async (_, next) => next({ db: await createDb() }))
  .it('対象の後にもmiddleware', t => t.argsFrom(ctx => [ctx.db])
    .expect(e => [e.result.toBe(3)]))

// @ts-expect-error a plain object is not a completion from next.
new Test().use(async () => ({ db: await createDb() }))
// @ts-expect-error cleanup is expressed with use, not a second setup argument.
new Test().setup(() => ({ value: 1 }), () => {})
const grouped = configured.group(child)
// @ts-expect-error middleware scope is fixed after the first group.
grouped.use(async (_, next) => next())
new Test().use(async (_, next) => {
  // @ts-expect-error context additions must be objects.
  return await next(1)
})
new Test().use(async (ctx, next) => {
  // @ts-expect-error a middleware cannot see the fields it has yet to supply.
  ctx.db
  return await next({ db: await createDb() })
})
new Test().setup(() => ({ value: 1 }))
  .use(async (ctx, next) => {
    expectType<number>(ctx.value)
    // @ts-expect-error context fields are readonly in middleware too.
    ctx.value = 2
    try {
      return await next({ value: String(ctx.value) })
    } finally {
      expectType<number>(ctx.value)
      // @ts-expect-error downstream fields do not change this middleware's input.
      expectType<string>(ctx.value)
    }
  })
  .setup(ctx => {
    expectType<string>(ctx.value)
    // @ts-expect-error the old field type is replaced, not intersected.
    expectType<number>(ctx.value)
    return { length: ctx.value.length }
  })
  .use((ctx, next) => next({ expected: ctx.length }))
  .target((value: string) => value.length)
  .it('setupとuseを順に重ねる', t => t.argsFrom(ctx => [ctx.value])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

const dependent = new Test<{ db: Db }>()
  .use(async (ctx, next) => next({ count: await ctx.db.countUsers() }))
  .target(countUsers).todo('要求型を保持する')
// @ts-expect-error middleware cannot discard a parent's required context.
run(dependent.plan())
run(configured.group(dependent).plan())

for (const step of suite.plan().steps) {
  if (step.kind === 'setup') expectType<Function>(step.create)
  else expectType<Function>(step.run)
}
// @ts-expect-error ordered preparation steps are immutable.
suite.plan().steps.push({ kind: 'setup', create: () => ({}) })
