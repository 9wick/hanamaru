# 実装検証用コード例の記録

このページは実装を検証する開発用の記録です。利用者向けの仕様や推奨例ではありません。仕様は[UX/DX契約](../guides/testing-contracts.md)に定めます。実装を仕様へ合わせる際に、対応する実行例・型の負例も更新します。

## 記録 1

<!-- example: docs/examples/user.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export const users = new Test()
  .target(createUser)
  // 振る舞いを変えたい依存だけ、共通のモックを設定する。
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toEqual({ id: 'u1' }),
    ])
    .expectCalls(call => [
      call(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ])
  )
  .it('保存に失敗したら通知しない', t => t
    // このケースだけ、共通設定を上書きする。
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [
      e.error.toBeInstanceOf(Error),
    ])
    .expectCalls(call => [
      call(mailService, 'send').notCalled(),
    ])
  )

registerTest(users)
```

## 記録 2

<!-- example: docs/spec/middleware-types.ts#derive -->
```ts
const base = new Test().target(add)
const tests = base.it('足す', t => t.args(1, 2).expect(e => [e.result.toBe(3)]))
// @ts-expect-error cases already declared cannot have their context replaced.
tests.use(middleware(async (_, next) => next({ n: 1 })))
// Deriving from the builder before any case starts a separate suite.
base.use(middleware(async (_, next) => next({ n: 1 })))
```

## 記録 3

<!-- example: docs/examples/test-builder.test.ts#targets -->
```ts
const byFunction = new Test().target(createUser)
const byMethod = new Test().target(userRepository, 'save')
const namedFunction = new Test().target('ユーザー作成', createUser)
const namedMethod = new Test().target('保存', userRepository, 'save')
```

## 記録 4

<!-- example: docs/examples/group-scopes.test.ts#group -->
```ts
const userGroup = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group('ユーザー', [createTests, saveTests])
```

## 記録 5

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

## 記録 6

<!-- example: docs/examples/test-builder.test.ts#stacked -->
```ts
const stacked = new Test()
  .use(middleware(async (_, next) => next({ a: 1 })))
  .use(middleware(async (ctx, next) => next({ expected: ctx.a + 2 })))
  .target(add)
  .it('middlewareを積み重ねる', t => t
    .argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

## 記録 7

<!-- example: docs/examples/mock.test.ts#mock -->
```ts
.mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
```

## 記録 8

<!-- example: docs/examples/case-modes.ts#modes -->
```ts
.it('保存する', t => t.args({ name: 'Alice' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
.only('集中して確認する', t => t.args({ name: 'Bob' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
.skip('修正待ち', t => t.args({ name: 'Carol' }).expect(e => [e.result.toEqual({ id: 'u1' })]))
.todo('送信失敗時の扱い')
```

## 記録 9

<!-- example: docs/examples/metadata.ts#blueprint -->
```ts
const blueprint = users.blueprint()
```

## 記録 10

<!-- example: docs/examples/it-builder.test.ts#failure-case -->
```ts
.it('保存に失敗したら通知しない', t => t
  .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
  .args({ name: 'Alice' })
  .expect(e => [
    e.error.toBeInstanceOf(Error),
  ])
  .expectCalls(call => [
    call(mailService, 'send').notCalled(),
  ])
)
```

## 記録 11

<!-- example: docs/examples/it-builder.test.ts#args -->
```ts
.it('引数をそのまま渡す', t => t
  .args(1, 2)
  .expect(e => [e.result.toBe(3)]))
.it('コンテキストから引数を作る', t => t
  .argsFrom(ctx => [ctx.a, ctx.b])
  .expect(e => [e.result.toBe(3)]))
```

## 記録 12

<!-- example: docs/examples/it-builder.test.ts#expectations -->
```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
])
.expectCalls(call => [
  call(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

## 記録 13

<!-- example: docs/examples/matchers.test.ts#result -->
```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
  e.result.toSatisfy(user => user.id.startsWith('u')),
])
```

## 記録 14

<!-- example: docs/examples/matchers.test.ts#error -->
```ts
.expect(e => [
  e.error.toBeInstanceOf(Error),
  e.error.toThrow('save failed'),
  e.error.not.toThrow('network failed'),
])
.expectCalls(call => [
  call(mailService, 'send').notCalled(),
])
```

## 記録 15

<!-- example: docs/examples/matchers.test.ts#not -->
```ts
.expect(e => [e.result.not.toBe(0)])
```

## 記録 16

<!-- example: docs/examples/matchers.test.ts#not-result -->
```ts
.expect(e => [e.result.not.toEqual({ id: 'missing' })])
```

## 記録 17

<!-- example: docs/examples/matchers.test.ts#calls -->
```ts
.expectCalls(call => [
  call(userRepository, 'save').calledOnceWith({ name: 'Alice' }),
])
```

## 記録 18

<!-- example: docs/examples/context-calls.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'

interface Client {
  send(id: string): Promise<void>
}

registerTest(new Test()
  .use(middleware(async (_, next) => {
    const client: Client = { async send(_id) {} }
    return next({ client, id: 'created-user' })
  }))
  .target((client: Client, id: string) => client.send(id))
  .it('準備したclientが生成したIDで呼ばれる', t => t
    .argsFrom(ctx => [ctx.client, ctx.id])
    .expectCalls(call => [
      call.from(ctx => ctx.client, 'send')
        .calledOnceWithFrom(ctx => [ctx.id]),
    ])))
```

## 記録 19

<!-- example: docs/examples/matchers.test.ts#context -->
```ts
const withContext = new Test()
  .target(add)
  .use(middleware(async (_, next) => next({ input: [1, 2] as const, expected: 3 })))
  .it('ctxを使う', t => t
    .argsFrom(ctx => [...ctx.input])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

## 記録 20

<!-- example: docs/examples/mock.test.ts#calls-fake -->
```ts
.mock(userRepository, 'save', m => m.callsFake(async input => ({ id: input.name })))
```

## 記録 21

<!-- example: docs/examples/mock.test.ts#sequence -->
```ts
.mock(api, 'fetch', m => m
  .rejectsOnce(new Error('temporary failure'))
  .resolves({ id: 'u1' }))
```

## 記録 22

<!-- example: docs/examples/mock.test.ts#verify -->
```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
])
.expectCalls(call => [
  call(userRepository, 'save').calledOnceWith({ name: 'Alice' }),
  call(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

## 記録 23

<!-- example: docs/examples/namespace-mock.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import * as data from './data.ts'
import { calc } from './calc.ts'

export const namespaceMock = new Test().target(calc)
  .it('依存を差し替える', t => t
    .mock(data, 'getData', m => m.returns(10))
    .args()
    .expect(e => [e.result.toBe(20)])
    .expectCalls(call => [call(data, 'getData').calledTimes(1)]))

registerTest(namespaceMock)
```

## 記録 24

<!-- example: docs/examples/math.ts -->
```ts
export function add(a: number, b: number): number {
  return a + b
}
```

## 記録 25

<!-- example: docs/examples/math.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add)
  .it('2つの数を足す', t => t.args(1, 2).expect(e => [
    e.result.toBe(3),
  ]))

registerTest(addition)
```

## 記録 26

<!-- example: docs/examples/user.ts -->
```ts
export interface User { id: string }
export interface CreateUserInput { name: string }

export const userRepository = {
  async save(_input: CreateUserInput): Promise<User> {
    return { id: 'u1' }
  },
}
export const mailService = {
  async send(_user: User): Promise<void> {},
}
export async function createUser(input: CreateUserInput): Promise<User> {
  const user = await userRepository.save(input)
  await mailService.send(user)
  return user
}
```

## 記録 27

<!-- example: docs/examples/calls.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

// モックを設定せず、本物の処理がどう呼ばれるかを検証する。
export const calls = new Test()
  .target(createUser)
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expectCalls(call => [
      call(userRepository, 'save').calledOnceWith({ name: 'Alice' }),
      call(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ]))

registerTest(calls)
```

## 記録 28

<!-- example: docs/examples/context.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'

export const contextAddition = new Test()
  .target(add)
  .use(middleware(async (_, next) => next({ a: 1, b: 2, expected: 3 })))
  .it('渡された値を使う', t => t
    .argsFrom(ctx => [ctx.a, ctx.b])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

registerTest(contextAddition)
```

## 記録 29

<!-- example: docs/examples/multiple-calls.test.ts#codec -->
```ts
import { Test, registerTest, relation } from 'hanamaru'

const encode = (value: string) => new TextEncoder().encode(value)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const input = 'こんにちは'

const codec = new Test()
  .target('codecの往復関係', relation({ encode, decode }))
  .it('元の値に戻る', t => t
    .calls(c => {
      const encoded = c.encode.args(input)
      return c.decode.args(encoded)
    })
    .expect(e => [e.result.toBe(input)]))

registerTest(codec)
```

## 記録 30

<!-- example: docs/examples/multiple-calls.test.ts#keys -->
```ts
const relationKey = (from: string, to: string) => JSON.stringify([from, to])

const keys = new Test()
  .target(relationKey)
  .it('異なる組み合わせを区別する', t => t
    .calls(c => ({
      first: c.args('ab', 'c'),
      second: c.args('a', 'bc'),
    }))
    .expect(e => [
      e.result.toSatisfy(({ first, second }) => first !== second),
    ]))

registerTest(keys)
```

## 記録 31

<!-- example: docs/examples/multiple-calls.test.ts#single -->
```ts
.target(relationKey)
.it('二つの値からキーを作る', t => t
  .args('ab', 'c')
  .expect(e => [e.result.toBe('["ab","c"]')]))
```

## 境界の型の記録 1

<!-- example: docs/spec/type-errors.ts#call-keys -->
```ts
// @ts-expect-error a non-function property is not observable.
ready.it('非メソッド', t => t.args(1, 2).expectCalls(call => [call({ label: 'a' }, 'label').notCalled()]))
// @ts-expect-error nonexistent keys are unavailable.
ready.it('キー違い', t => t.args(1, 2).expectCalls(call => [call(mailService, 'save').notCalled()]))
// @ts-expect-error call arguments follow the original method.
ready.it('引数型', t => t.args(1, 2).expectCalls(call => [call(mailService, 'send').calledOnceWith({ id: 1 })]))
```

## 境界の型の記録 2

<!-- example: docs/examples/call-descriptor-source.ts#expect-calls -->
```ts
.expectCalls(call => [
  call(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

## 移行前の実行例 1

<!-- example: docs/examples/each.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add)
  .each('2つの数を足す', [
    { a: 1, b: 2, expected: 3 },
    { a: 2, b: 3, expected: 5 },
  ], (t, row) => t
    .args(row.a, row.b)
    .expect(e => [e.result.toBe(row.expected)]))

registerTest(addition)
```

## 移行前の実行例 2

<!-- example: docs/examples/each-name.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { add } from './math.ts'

export const namedRows = new Test().target(add).each(
  row => `${row.a} + ${row.b}`,
  [{ a: 1, b: 2, expected: 3 }],
  (t, row) => t.args(row.a, row.b).expect(e => [e.result.toBe(row.expected)]),
)

registerTest(namedRows)
```

## 移行前の実行例 3

<!-- example: docs/examples/groups.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

const creation = new Test()
  .target(createUser)
  .mock(userRepository, 'save', m => m.resolves({ id: 'mock-user' }))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'mock-user' })])
    .expectCalls(call => [
      call(mailService, 'send').calledOnceWith({ id: 'mock-user' }),
    ]))
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [e.error.toThrow('save failed')])
    .expectCalls(call => [call(mailService, 'send').notCalled()]))

const saving = new Test()
  .target(userRepository, 'save')
  .it('ユーザーを保存する', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'u1' })]))

export const registrations = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group('作成', [creation])
  .group([saving])

registerTest(registrations)
```

## 移行前の実行例 4

<!-- example: docs/examples/group-middleware.test.ts#group-middleware -->
```ts
export const serverTests = new Test()
  .group(middleware(async (_, next) => {
    const server = await startServer()
    try {
      return await next({ server })
    } finally {
      await server.stop()
    }
  }), [listUsers, missingPage])
```

## 移行前の実行例 5

<!-- example: docs/examples/group-supply.test.ts#supply -->
```ts
const child = new Test<{ seed: number }>()
  .target((value: number) => value)
  .it('渡された値を使う', t => t.argsFrom(ctx => [ctx.seed])
    .expect(e => [e.result.toBe(e.ctx.seed)]))

const provideSeed = middleware(async (_, next) => next({ seed: 2 }))
export const suppliedPerAttempt = new Test().use(provideSeed).group([child])
export const suppliedPerGroup = new Test().group(provideSeed, [child])
```

## 移行前の実行例 6

<!-- example: docs/examples/group-supply.test.ts#group-phase -->
```ts
const expectedChild = new Test<{ expected: number }>()
  .target((value: number) => value)
  .it('groupが渡す期待値', t => t.argsFrom(ctx => [ctx.expected])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

const seededGroup = new Test<{ seed: number }>()
  .group(middleware(async (ctx, next) =>
    next({ expected: ctx.seed + 1 })), [expectedChild])

export const seededTests = new Test().group(provideSeed, [seededGroup])
```

## 移行前の実行例 7

<!-- example: docs/examples/group-scopes.test.ts#names -->
```ts
const grouped = new Test()
  .group('基本', [addition, subtraction])
  .group('再確認', [addition])
```

## 移行前の実行例 8

<!-- example: docs/examples/group-scopes.test.ts#nesting -->
```ts
const inner = new Test().group('内側', [addition])
const outer = new Test().group('外側', [inner])
```

## 移行前の実行例 9

<!-- example: docs/examples/group-scopes.test.ts#scoped-mock -->
```ts
const userGroup = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group('ユーザー', [createTests, saveTests])

const scoped = new Test()
  .group([userGroup])
  .group('メール', [mailTests])
```

## 移行前の実行例 10

<!-- example: docs/examples/user-cases.ts -->
```ts
import { Test, middleware } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export interface UserContext {
  input: { name: string }
  expectedId: string
}

export const userCases = new Test<UserContext>()
  .target(createUser)
  .use(middleware(async (ctx, next) => next({ expected: { id: ctx.expectedId } })))
  .it('保存して通知する', t => t
    .argsFrom(ctx => [ctx.input])
    .expect(e => [e.result.toEqual(e.ctx.expected)])
    .expectCalls(call => [call(mailService, 'send').calledTimes(1)]))
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .argsFrom(ctx => [ctx.input])
    .expect(e => [e.error.toThrow('save failed')])
    .expectCalls(call => [call(mailService, 'send').notCalled()]))
```

## 移行前の実行例 11

<!-- example: docs/examples/user-cases.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'
import { userRepository, mailService } from './user.ts'
import { userCases } from './user-cases.ts'

export const userCaseTests = new Test()
  .use(middleware(async (_, next) => next({ input: { name: 'Alice' }, expectedId: 'u1' })))
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group([userCases])

registerTest(userCaseTests)
```

## 移行前の実行例 12

<!-- example: docs/examples/execution-options.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { add } from './math.ts'

const addition = new Test()
  .target(add)
  .timeout(2_000)
  .it('足す', t => t
    .args(1, 2)
    .expect(e => [e.result.toBe(3)]))
  .it('再試行せず足す', t => t
    .timeout(500)
    .retry(0)
    .args(2, 3)
    .expect(e => [e.result.toBe(5)]))

export const tests = new Test()
  .timeout(5_000)
  .retry(2)
  .group([addition])

registerTest(tests)
```

## 移行前の実行例 13

<!-- example: docs/examples/reusable-middleware.test.ts -->
```ts
import { Test, registerTest, middleware, type Ctx } from 'hanamaru'
import { add } from './math.ts'

// 変数へ入れて使い回すmiddlewareには文脈がないので、読む値をCtx<…>で要求する。
const withExpected = middleware(async (ctx: Ctx<{ seed: number }>, next) =>
  next({ expected: ctx.seed + 1 }))

export const reusedMiddleware = new Test()
  .use(middleware(async (_, next) => next({ seed: 2 })))
  .use(withExpected)
  .target(add)
  .it('要求したseedから期待値を作る', t => t
    .argsFrom(ctx => [ctx.seed, 1])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

registerTest(reusedMiddleware)
```

## 移行前の実行例 14

<!-- example: docs/examples/context-flow.test.ts#values -->
```ts
.use(middleware(async (_, next) => next({ a: 1, expected: 3 })))
```

## 移行前の実行例 15

<!-- example: docs/examples/middleware-patterns.test.ts#wrap -->
```ts
.use(middleware(async (_, next) => {
  return await storage.run({ requestId: 'test' }, async () => {
    return await next()
  })
}))
```

## 移行前の実行例 16

<!-- example: docs/examples/middleware-patterns.test.ts#timeout -->
```ts
.use(middleware(async (_, next) => {
  const db = await createDatabase()
  try {
    return await next({ db })
  } finally {
    await db.close()
  }
}, { timeout: 30_000 }))
```

## 移行前の実行例 17

<!-- example: docs/examples/in-source.ts -->
```ts
import type {} from 'hanamaru'
import * as data from './data.ts'

const multiplier = 2
function privateCalc() { return data.getData() * multiplier }

if (import.meta.hanamaru) {
  const { Test, registerTest } = import.meta.hanamaru
  registerTest(new Test().mock(data, 'getData', m => m.returns(10)).target(privateCalc)
    .it('非公開の実装と依存を検証する', t => t.args().expect(e => [e.result.toBe(20)])))
}
```

## 移行前の実行例 18

<!-- example: docs/examples/metadata.ts -->
```ts
import { users } from './user.test.ts'

const blueprint = users.blueprint()
console.log(blueprint.kind, blueprint.version)
```

## 移行前の実行例 19

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
      // 子グループのsteps・mocks・childrenを取得できる。
    } else {
      // 対象ケース群のtarget・casesを取得できる。
    }
  }
}
```

## 移行前の実行例 20

<!-- example: docs/examples/call-descriptor.test.ts#descriptor -->
```ts
.expect(e => [e.result.toMatchObject({
  subject: 'call',
  object: mailService,
  key: 'send',
  check: { matcher: 'calledOnceWith', args: [{ id: 'u1' }] },
})])
```

## 移行前の実行例 21

<!-- example: docs/examples/context-flow.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'

export const contextFlow = new Test()
  .target(add)
  .use(middleware(async (_, next) => next({ a: 1, expected: 3 })))
  .it('渡された値を使う', t => t
    .argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

registerTest(contextFlow)
```

## 移行前の実行例 22

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

## 移行前の実行例 23

<!-- example: docs/spec/type-errors.ts#outcome-mix -->
```ts
// @ts-expect-error result and error assertions cannot coexist.
ready.it('矛盾', t => t.args(1, 2).expect(e => [e.result.toBe(3), e.error.toThrow('bad')]))
// @ts-expect-error reversed ordering cannot hide contradictory expectations.
ready.it('逆順の矛盾', t => t.args(1, 2).expect(e => [e.error.toThrow('bad'), e.result.toBe(3)]))
// @ts-expect-error at least one assertion is required.
ready.it('空配列', t => t.args(1, 2).expect(() => []))
// @ts-expect-error matcher must be called.
ready.it('未完了', t => t.args(1, 2).expect(e => [e.result]))
```

## 移行前の実行例 24

<!-- example: docs/examples/hanamaru.config.ts -->
```ts
import { defineConfig } from 'hanamaru'

export default defineConfig({
  projects: {
    default: {
      include: ['**/*.{test,spec}.ts'],
      exclude: ['**/node_modules/**', '**/dist/**'],
    },
  },
  reporter: 'pretty',
  collectionTimeout: 120_000,
  shutdownGrace: 5_000,
})
```

## 移行前の実行例 25

<!-- example: docs/examples/hanamaru-vite.config.ts -->
```ts
import { resolve } from 'node:path'
import { defineConfig } from 'hanamaru'

export default defineConfig({
  vite: {
    resolve: {
      alias: { '@app': resolve('src') },
    },
    plugins: [],
  },
})
```

## 移行前の実行例 26

<!-- example: docs/examples/resources.test.ts#lifecycle -->
```ts
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
```

## 移行前の実行例 27

<!-- example: docs/examples/run-many.ts#accept -->
```ts
registerTest(addition)
registerTest(users)
```
