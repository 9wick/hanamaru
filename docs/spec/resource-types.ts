import { Test, resource, run, middleware } from 'hanamaru'
import type { Resource, TestDefinition } from 'hanamaru'
declare function expectType<T>(value: T): void

const db = resource({ scope: 'perRun', async setup(ctx, next) {
  // @ts-expect-error root resource has no inherited middleware context.
  ctx.url
  return await next({ dbUrl: 'db://test' })
} })
expectType<Resource<{ dbUrl: string }, 'perRun'>>(db)
const schema = resource({ scope: 'perWorker', require: [db], async setup(ctx, next) {
  expectType<string>(ctx.dbUrl)
  // @ts-expect-error setup only sees declared resource dependencies.
  ctx.client
  return await next({ schemaUrl: `${ctx.dbUrl}/schema` })
} })
const definition: TestDefinition = new Test().require(schema).target((s: string) => s)
  .it('case', t => t.argsFrom(ctx => {
    expectType<string>(ctx.schemaUrl)
    // @ts-expect-error transitive dependencies are not exported implicitly.
    ctx.dbUrl
    return [ctx.schemaUrl]
  }).expect(e => [e.result.toBe(e.ctx.schemaUrl)]))
run(definition)
run(new Test().target((s: string) => s).it('case resource', t => t.require(db)
  .argsFrom(ctx => [ctx.dbUrl]).expect(e => [e.result.toBe(e.ctx.dbUrl)])))
const child = new Test<{ dbUrl: string }>().group(middleware(async (ctx, next) => {
  expectType<string>(ctx.dbUrl)
  return await next()
}), [new Test<{ dbUrl: string }>().target(() => 1).it('child', t => t.args().expect(e => [e.result.toBe(1)]))])
run(new Test().require(db).group([child]))
resource({ scope: 'perRun', async setup(_, next) {
  // @ts-expect-error functions cannot be supplied by resources.
  return await next({ connect: () => 1 })
} })
resource({ scope: 'perRun', async setup(_, next) {
  // @ts-expect-error undefined is not part of JSON values.
  return await next({ x: undefined })
} })
resource({ scope: 'perRun', async setup(_, next) {
  // @ts-expect-error bigint is not part of JSON values.
  return await next({ x: 1n })
} })
