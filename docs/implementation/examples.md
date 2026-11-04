# 実行可能な使用例

UX/DXの契約は[テストを書く](../guides/writing-tests.md)と[契約テストの考え方](../guides/testing-contracts.md)を正本とします。このページは、その構文を実行するソースへの入口です。コードはdocs/examplesから同期し、型の禁止例はdocs/specで検証します。

## 環境と副作用

対象のクラスと操作を固定し、依存をenvironmentから供給します。代替環境の保存状態・配送済み状態はsubstitute-effectとして観測します。本物の外部配送が完了したという証拠には扱いません。

<!-- example: docs/examples/user-environment.ts -->
```ts
import { environment } from 'hanamaru'
import { UserService, type CreateUserInput, type UserRepository, type Mailer } from './user.ts'

export function userEnvironment(options: { id?: string; saveFails?: boolean } = {}) {
  return environment(async (_, scope, next) => {
    const rows = new Map<string, CreateUserInput>()
    const inbox = new Map<string, { recipient: string }>()
    const repository: UserRepository = {
      async save(input) {
        if (options.saveFails) throw new Error('save failed')
        const id = options.id ?? 'u1'
        rows.set(id, { ...input })
        return { id }
      },
    }
    const mailer: Mailer = {
      async send(user) {
        if (!rows.has(user.id)) throw new Error('unknown recipient')
        inbox.set(user.id, { recipient: user.id })
      },
    }
    return next({
      users: new UserService(repository, mailer),
      saved: scope.state({ evidence: 'substitute-effect', read: (id: string) => rows.get(id) }),
      delivered: scope.state({ evidence: 'substitute-effect', read: () => [...inbox.values()] }),
    })
  })
}
```

成功と失敗の期待は、対象の契約に合わせて記述します。

<!-- example: docs/examples/user.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { UserService } from './user.ts'
import { userEnvironment } from './user-environment.ts'

const successful = new Test().target(UserService, 'create').effectful()
  .use(userEnvironment()).from(ctx => ctx.users)
  .it('保存して通知する', t => t.args({ name: 'Alice' }).expect(e => [
    e.result.toEqual({ id: 'u1' }),
    e.state(e.ctx.saved, e.result.field('id')).toEqual({ name: 'Alice' }),
    e.state(e.ctx.delivered).toEqual([{ recipient: 'u1' }]),
  ]))
const failing = new Test().target(UserService, 'create').effectful()
  .use(userEnvironment({ saveFails: true })).from(ctx => ctx.users)
  .it('保存失敗を返し、通知しない', t => t.args({ name: 'Alice' }).expect(e => [
    e.error.message.toEqual('save failed'),
    e.state(e.ctx.delivered).toEqual([]),
  ]))
export const users = new Test().group('ユーザー登録', [successful, failing])
registerTest(users)
```

呼び出し記録しか得られない境界は[call-recordの例](../examples/call-record.test.ts)を参照してください。実効果や代替環境の効果と区別して報告します。

## 具体例と性質

具体例は具体値・部分・許容誤差で、性質はpropertyの名前付き述語で記述します。

<!-- example: docs/examples/matchers.test.ts -->
```ts
import { Test, registerTest, tuples, integers } from 'hanamaru'
import { add } from './math.ts'
const values = new Test().target((a: number, b: number) => ({ sum: a + b }))
  .it('具体的な部分を照合する', t => t.args(0.1, 0.2).expect(e => [
    e.result.part('sum').toBeCloseTo(0.3, { absoluteTolerance: 1e-12 }),
  ]))
const positive = new Test().target(add)
  .property('正数同士の和は正', p => p.forAll(tuples(integers({ min: 1, max: 100 }), integers({ min: 1, max: 100 })))
    .expect(e => [e.on(e.result).satisfies('正である', sum => sum > 0)]))
const failing = new Test().target((message: string) => { throw new TypeError(message) })
  .it('具体的な例外を返す', t => t.args('invalid').expect(e => [e.error.ofType(TypeError).part('message').toEqual('invalid')]))
registerTest(new Test().group([values, positive, failing]))
```

複数操作の具体例はscenarioのitで検証できます。複数実行を必要とする性質はpropertyのstepsに記述します。

<!-- example: docs/examples/multiple-calls.test.ts -->
```ts
import { Test, registerTest, scenario, tuples, constant } from 'hanamaru'

const encode = (value: string) => new TextEncoder().encode(value)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const input = 'こんにちは'

const codec = new Test()
  .target('codecの往復関係', scenario({ encode, decode }))
  .it('元の値に戻る', t => t
    .steps(c => {
      const encoded = c.encode.args(input)
      return c.decode.args(encoded)
    })
    .expect(e => [e.result.toBe(input)]))

registerTest(codec)

const relationKey = (from: string, to: string) => JSON.stringify([from, to])

const keys = new Test()
  .target(relationKey)
  .property('異なる組み合わせを区別する', p => p
    .forAll(tuples(constant('ab'), constant('c')))
    .steps(s => ({ first: s.target.args(s.input[0], s.input[1]), second: s.target.args('a', 'bc') }))
    .expect(e => [
      e.on(e.result).satisfies('異なる組を区別する', ({ first, second }) => first !== second),
    ]))

registerTest(keys)

const single = new Test()
  .target(relationKey)
  .it('二つの値からキーを作る', t => t
    .args('ab', 'c')
    .expect(e => [e.result.toBe('["ab","c"]')]))

registerTest(single)
```

## その他の入口

| 目的 | 実行例 |
|---|---|
| 対象と名前の指定 | [test-builder](../examples/test-builder.test.ts) |
| 引数と期待 | [it-builder](../examples/it-builder.test.ts) |
| 結果に依存する状態の読取 | [result-observation](../examples/result-observation.test.ts) |
| 代替環境の供給 | [substitute-environment](../examples/substitute-environment.test.ts) |
| importした依存を含む実行 | [module-dependency](../examples/module-dependency.test.ts) |
| グループと共有コンテキスト | [groups](../examples/groups.test.ts)、[user-cases](../examples/user-cases.test.ts) |
| 資源の寿命 | [resources](../examples/resources.test.ts) |
| ソース内テスト | [in-source](../examples/in-source.ts) |
| eachの具体例 | [each](../examples/each.test.ts) |
| 実行設定 | [execution-options](../examples/execution-options.test.ts) |

`npm run test:examples`はこれらの実行例をCLIで検証します。`npm run typecheck`は実行例と型の禁止例を検査し、`npm run check:docs`は文書に同期したコードとの一致を検査します。

## blueprintの階層

<!-- example: docs/examples/blueprint-tree.ts -->
```ts
import { registrations } from './groups.test.ts'

const blueprint = registrations.blueprint()
for (const group of blueprint.children) {
  // このチェーンの各group呼び出し。group.nameとgroup.middlewareを取得できる。
  for (const entry of group.children) {
    const child = entry.blueprint
    if (child.kind === 'definition') {
      // 子チェーンの共通設定と、その中のgroup呼び出しを取得できる。
    } else if (child.kind === 'group') {
      // 子グループのsteps・childrenを取得できる。
    } else {
      // 対象ケース群のtarget・casesを取得できる。
    }
  }
}
```

## 呼び出し記録の証拠

<!-- example: docs/examples/call-record.test.ts -->
```ts
import { Test, environment, registerTest } from 'hanamaru'

// 実効果を観測できない境界の妥協は、環境がcall-recordとして明示する。
const boundary = environment(async (_, scope, next) => {
  const requests: { recipient: string }[] = []
  const send = async (recipient: string) => { requests.push({ recipient }) }
  return next({ send, requests: scope.state({ evidence: 'call-record', read: () => requests }) })
})
const requestNotification = async (send: (recipient: string) => Promise<void>, id: string) => send(id)
export const calls = new Test().target(requestNotification).effectful().use(boundary)
  .it('境界へ通知を依頼する', t => t.argsFrom(ctx => [ctx.send, 'u1'])
    .expect(e => [e.state(e.ctx.requests).toEqual([{ recipient: 'u1' }])]))
registerTest(calls)
```

## 実行ケースの選択

<!-- example: docs/examples/case-modes.ts -->
```ts
import { Test } from 'hanamaru'
import { add } from './math.ts'
// onlyを含むため、CLIの探索対象になる *.test.ts には置かない。
export const caseModes = new Test().target(add)
  .it('加算する', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
  .only('集中して確認する', t => t.args(2, 3).expect(e => [e.result.toEqual(5)]))
  .skip('修正待ち', t => t.args(3, 4).expect(e => [e.result.toEqual(7)]))
  .todo('境界値を追加する')
```

## グループのコンテキスト

<!-- example: docs/examples/group-context.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'

const child = new Test<{ a: number }>()
  .target(add)
  .it('親の値を使う', t => t.argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(3)]))

export const parentContext = new Test()
  .use(middleware(async (_, next) => next({ a: 1, extra: true })))
  .group([child])

registerTest(parentContext)
```

## グループの前後処理

<!-- example: docs/examples/group-middleware.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'
import { request, startServer, type Server } from './server.ts'

const listUsers = new Test<{ server: Server }>()
  .target(request)
  .it('一覧は200を返す', t => t
    .argsFrom(ctx => [ctx.server, '/users'])
    .expect(e => [e.result.toBe(200)]))

const missingPage = new Test<{ server: Server }>()
  .target(request)
  .it('未知のパスは404を返す', t => t
    .argsFrom(ctx => [ctx.server, '/missing'])
    .expect(e => [e.result.toBe(404)]))

export const serverTests = new Test()
  .group(middleware(async (_, next) => {
    const server = await startServer()
    try {
      return await next({ server })
    } finally {
      await server.stop()
    }
  }), [listUsers, missingPage])

registerTest(serverTests)
```

## グループの入れ子

<!-- example: docs/examples/group-scopes.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'
import { userCases } from './user-cases.ts'
const addition = new Test().target(add).it('加算', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
const subtraction = new Test().target((a: number, b: number) => a - b).it('減算', t => t.args(3, 1).expect(e => [e.result.toEqual(2)]))
const grouped = new Test().group('基本', [addition, subtraction]).group('再確認', [addition])
const inner = new Test().group('内側', [addition])
const outer = new Test().group('外側', [inner])
const userGroup = new Test().group('ユーザー', middleware(async (_, next) => next({ input: { name: 'Alice' }, expectedId: 'u1' })), [userCases])
registerTest(new Test().group([grouped, outer, userGroup]))
```

## グループへの値の供給

<!-- example: docs/examples/group-supply.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'

const child = new Test<{ seed: number }>()
  .target((value: number) => value)
  .it('渡された値を使う', t => t.argsFrom(ctx => [ctx.seed])
    .expect(e => [e.result.toBe(e.ctx.seed)]))

const provideSeed = middleware(async (_, next) => next({ seed: 2 }))
export const suppliedPerAttempt = new Test().use(provideSeed).group([child])
export const suppliedPerGroup = new Test().group(provideSeed, [child])

const expectedChild = new Test<{ expected: number }>()
  .target((value: number) => value)
  .it('groupが渡す期待値', t => t.argsFrom(ctx => [ctx.expected])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

const seededGroup = new Test<{ seed: number }>()
  .group(middleware(async (ctx, next) =>
    next({ expected: ctx.seed + 1 })), [expectedChild])

export const seededTests = new Test().group(provideSeed, [seededGroup])

registerTest(suppliedPerAttempt)
registerTest(suppliedPerGroup)
registerTest(seededTests)
```

## ソース内テスト

<!-- example: docs/examples/in-source.ts -->
```ts
import type {} from 'hanamaru'
import { getData } from './data.ts'
const multiplier = 2
function privateCalc() { return getData() * multiplier }
if (import.meta.hanamaru) {
  const { Test, registerTest } = import.meta.hanamaru
  registerTest(new Test().target(privateCalc)
    .it('取得値を2倍する', t => t.args().expect(e => [e.result.toEqual(10)])))
}
```

## 引数と具体的な期待

<!-- example: docs/examples/it-builder.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'
import { UserService } from './user.ts'
import { userEnvironment } from './user-environment.ts'
const creation = new Test().target(UserService, 'create').effectful().use(userEnvironment()).from(ctx => ctx.users)
  .it('保存して通知する', t => t.args({ name: 'Alice' }).expect(e => [
    e.result.toEqual({ id: 'u1' }), e.state(e.ctx.delivered).toEqual([{ recipient: 'u1' }]),
  ]))
const failing = new Test().target(UserService, 'create').effectful().use(userEnvironment({ saveFails: true })).from(ctx => ctx.users)
  .it('保存失敗時は配送しない', t => t.args({ name: 'Alice' }).expect(e => [
    e.error.message.toEqual('save failed'), e.state(e.ctx.delivered).toEqual([]),
  ]))
const addition = new Test().use(middleware(async (_, next) => next({ a: 1, b: 2 }))).target(add)
  .it('具体的な引数', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
  .it('コンテキストから引数を作る', t => t.argsFrom(ctx => [ctx.a, ctx.b]).expect(e => [e.result.toEqual(3)]))
registerTest(new Test().group([creation, failing, addition]))
```

## blueprintの取得

<!-- example: docs/examples/metadata.ts -->
```ts
import { users } from './user.test.ts'

const blueprint = users.blueprint()
console.log(blueprint.kind, blueprint.version)
```

## middlewareの合成

<!-- example: docs/examples/middleware.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'
import { createDatabase, countUsers } from './database.ts'

export const userCount = new Test()
  .use(middleware(async (_, next) => {
    const db = await createDatabase()
    try {
      return await next({ db, expected: 3 })
    } finally {
      await db.close()
    }
  }))
  .target(countUsers)
  .it('ユーザー数を取得する', t => t
    .argsFrom(ctx => [ctx.db])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

registerTest(userCount)
```

## importされた依存

<!-- example: docs/examples/module-dependency.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { calc } from './calc.ts'
// importされた依存も含めて対象の契約を実行する。
registerTest(new Test().target(calc).it('取得値を2倍する', t => t.args().expect(e => [e.result.toEqual(10)])))
```

## 共有資源の寿命

<!-- example: docs/examples/resources.test.ts -->
```ts
import { Test, resource, registerTest } from 'hanamaru'

// 接続情報だけを供給し、環境を起動・停止するhandleはsetupのclosureに保持する。
async function startDatabase() {
  return { url: 'db://example', stop: async () => {} }
}
async function createSchema(databaseUrl: string) {
  return { url: `${databaseUrl}/schema`, drop: async () => {} }
}
const query = (schemaUrl: string) => schemaUrl.endsWith('/schema') ? 1 : 0

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
registerTest(queries)

const direct = new Test().target(query)
  .it('case requirement', t => t.require(schema).argsFrom(ctx => [ctx.schemaUrl])
    .expect(e => [e.result.toBe(1)]))
registerTest(direct)

const child = new Test<{ schemaUrl: string }>().target(query)
  .it('group requirement', t => t.argsFrom(ctx => [ctx.schemaUrl]).expect(e => [e.result.toBe(1)]))
registerTest(new Test().require(schema).group('queries', [child]))
```

## 結果に依存する観測

<!-- example: docs/examples/result-observation.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { UserService } from './user.ts'
import { userEnvironment } from './user-environment.ts'
registerTest(new Test().target(UserService, 'create').effectful().use(userEnvironment()).from(ctx => ctx.users)
  .it('結果のIDで保存状態を読む', t => t.args({ name: 'Alice' })
    .expect(e => [e.state(e.ctx.saved, e.result.field('id')).toEqual({ name: 'Alice' })])))
```

## 複数定義の登録

<!-- example: docs/examples/run-many.ts -->
```ts
import { registerTest } from 'hanamaru'
import { addition } from './math.test.ts'
import { users } from './user.test.ts'

registerTest(addition)
registerTest(users)
```

## 代替環境

<!-- example: docs/examples/substitute-environment.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { UserService } from './user.ts'
import { userEnvironment } from './user-environment.ts'

const successful = new Test().target(UserService, 'create').effectful()
  .use(userEnvironment({ id: 'custom-id' })).from(ctx => ctx.users)
  .it('代替環境の保存と配送を検証する', t => t.args({ name: 'Alice' }).expect(e => [
    e.result.toEqual({ id: 'custom-id' }),
    e.state(e.ctx.saved, e.result.field('id')).toEqual({ name: 'Alice' }),
    e.state(e.ctx.delivered).toEqual([{ recipient: 'custom-id' }]),
  ]))
registerTest(successful)
```

## 対象の指定

<!-- example: docs/examples/test-builder.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'
const calculator = { sum: add }
const byFunction = new Test().target(add)
const byMethod = new Test().target(calculator, 'sum')
const namedFunction = new Test().target('加算', add)
const namedMethod = new Test().target('合計', calculator, 'sum')
const creating = byFunction.it('関数', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
const saving = byMethod.it('メソッド', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
const namedCreating = namedFunction.it('名前付き関数', t => t.args(2, 3).expect(e => [e.result.toEqual(5)]))
const namedSaving = namedMethod.it('名前付きメソッド', t => t.args(2, 3).expect(e => [e.result.toEqual(5)]))
const stacked = new Test()
  .use(middleware(async (_, next) => next({ a: 1 })))
  .use(middleware(async (ctx, next) => next({ expected: ctx.a + 2 })))
  .target(add).it('コンテキストを合成する', t => t.argsFrom(ctx => [ctx.a, 2]).expect(e => [e.result.toEqual(e.ctx.expected)]))
registerTest(new Test().group([creating, saving, namedCreating, namedSaving, stacked]))
```

## ケースの再利用

<!-- example: docs/examples/user-cases.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'
import { userCases } from './user-cases.ts'
export const userCaseTests = new Test()
  .group(middleware(async (_, next) => next({ input: { name: 'Alice' }, expectedId: 'u1' })), [userCases])
registerTest(userCaseTests)
```
