import { Test, resource, registerTest } from 'hanamaru'

// 接続情報だけを供給し、環境を起動・停止するhandleはsetupのclosureに保持する。
async function startDatabase() {
  return { url: 'db://example', stop: async () => {} }
}
async function createSchema(databaseUrl: string) {
  return { url: `${databaseUrl}/schema`, drop: async () => {} }
}
const query = (schemaUrl: string) => schemaUrl.endsWith('/schema') ? 1 : 0

// #region lifecycle
const database = resource({
  name: 'database',
  scope: 'perRun',
  async setup(_, next) {
    const db = await startDatabase()
    try {
      return await next({ databaseUrl: db.url })
    } finally {
      await db.stop()
    }
  },
})

const schema = resource({
  name: 'schema',
  scope: 'perWorker',
  require: [database],
  async setup(ctx, next) {
    const created = await createSchema(ctx.databaseUrl)
    try {
      return await next({ schemaUrl: created.url })
    } finally {
      await created.drop()
    }
  },
})

const queries = new Test().require(schema).target(query)
  .it('query', t => t.argsFrom(ctx => [ctx.schemaUrl]).expect(e => [e.result.toBe(1)]))
// #endregion lifecycle
registerTest(queries)

const direct = new Test().target(query)
  .it('case requirement', t => t.require(schema).argsFrom(ctx => [ctx.schemaUrl])
    .expect(e => [e.result.toBe(1)]))
registerTest(direct)

const child = new Test<{ schemaUrl: string }>().target(query)
  .it('group requirement', t => t.argsFrom(ctx => [ctx.schemaUrl]).expect(e => [e.result.toBe(1)]))
registerTest(new Test().require(schema).group('queries', [child]))
