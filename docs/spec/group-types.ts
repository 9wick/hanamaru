import { Test, middleware, run } from 'hanamaru'
import type { GroupEntry, GroupMiddlewareResult, MiddlewareResult, TestBlueprint, TestDefinition } from 'hanamaru'
import { add } from '../examples/math.ts'
import { mailService } from '../examples/user.ts'
import { registrations } from '../examples/groups.test.ts'

declare function expectType<T>(value: T): void

const child = new Test<{ seed: number }>()
  .use(middleware(async (ctx, next) => {
    expectType<number>(ctx.seed)
    return await next({ expected: ctx.seed + 1 })
  }))
  .target(add)
  .it('親のctxから値を作る', t => t.argsFrom(ctx => [ctx.seed, 1])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

const parent = new Test()
  .use(middleware(async (_, next) => next({ seed: 2, extra: true })))
  .group([child])
  .group('同じ子をもう一度使う', [child])
run(parent)
run([parent, registrations])

const nested = new Test<{ seed: number }>().group([child])
run(new Test().use(middleware(async (_, next) => next({ seed: 3 }))).group([nested]))
const independent = new Test().target(add)
  .it('ctxを要求しない', t => t.args(1, 2).expect(e => [e.result.toBe(3)]))
const nestedGroups = new Test().group('外側', [
  new Test().group('内側', [independent]),
])
expectType<'definition'>(nestedGroups.blueprint().kind)
const outerGroup = nestedGroups.blueprint().children[0]
expectType<'group'>(outerGroup.kind)
expectType<string | null>(outerGroup.name)
const nestedDefinition = outerGroup.children[0].blueprint
if (nestedDefinition.kind === 'definition') {
  const innerGroup = nestedDefinition.children[0]
  expectType<'group'>(innerGroup.kind)
  expectType<string | null>(innerGroup.name)
}
const combined = new Test<{ seed: number }>().group('複数の対象をまとめる', [child, independent])
run(new Test().use(middleware(async (_, next) => next({ seed: 3 }))).group([combined]))
new Test().group([independent])
new Test().use(middleware(async (_, next) => next({ seed: 1 }))).group([independent])
new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group([independent])
new Test().mock(mailService, 'send', m => m.resolves(undefined))
  .target(add).todo('対象の前にも共通設定を書ける')
const annotated: TestDefinition<{ seed: number }> = child
new Test().use(middleware(async (_, next) => next({ seed: 1 }))).group([annotated])

// @ts-expect-error the parent must supply the child's required context.
new Test().group([child])
// @ts-expect-error every child in the array must receive its required context.
new Test().group([independent, child])
// @ts-expect-error named groups must enforce the same requirement.
new Test().group('不足', [child])
// @ts-expect-error a field with the wrong type cannot satisfy the child.
new Test().use(middleware(async (_, next) => next({ seed: '2' }))).group([child])
// @ts-expect-error an optional field cannot satisfy a required field.
new Test().use(middleware(async (_, next) => next({} as { seed?: number }))).group([child])
// @ts-expect-error nesting cannot discard the context requirement.
new Test().group([nested])
// @ts-expect-error type annotations must not erase required context.
const erasedDefinition: TestDefinition = child
// @ts-expect-error the child cannot run without its parent.
run(child)
// @ts-expect-error arrays cannot hide a missing context provider.
run([independent, child])
// @ts-expect-error a group's declared input is still required at the root.
run(nested)
// @ts-expect-error even locally shadowing an input does not remove an input contract.
run(new Test<{ seed: number }>().use(middleware(async (_, next) => next({ seed: 1 }))).target(add).todo('後で'))

// @ts-expect-error middleware is fixed after the first group.
parent.use(middleware(async (_, next) => next({ seed: 4 })))
// @ts-expect-error mock scope is fixed after the first group.
parent.mock(mailService, 'send', m => m.resolves(undefined))
// @ts-expect-error describe is no longer part of the API.
parent.describe('変更')
// @ts-expect-error a group is a container; targets belong to its children.
parent.target(add)
// @ts-expect-error a group does not declare cases without a target.
parent.it('対象なし', () => {})
// @ts-expect-error an empty container is not a finished definition.
new Test().group([new Test()])
// @ts-expect-error a configured target needs at least one case.
new Test().group([new Test().target(add)])
// @ts-expect-error an empty group has no children.
new Test().group([])
// @ts-expect-error group children are always passed as an array.
new Test().group(independent)
// @ts-expect-error named groups also require an array.
new Test().group('名前付き', independent)
// @ts-expect-error an empty container cannot be run.
run(new Test())
// @ts-expect-error group names are strings when present.
new Test().group(123, [independent])
const parentBlueprint: TestBlueprint = parent.blueprint()
expectType<'definition'>(parent.blueprint().kind)
const firstGroup = parent.blueprint().children[0]
expectType<'group'>(firstGroup.kind)
// @ts-expect-error run accepts a completed test, not its blueprint.
run(parentBlueprint)
// @ts-expect-error blueprint structure is readonly.
parent.blueprint().children.push(independent.blueprint())

// Each middleware receives the accumulated context; later fields replace earlier ones.
new Test()
  .use(middleware(async (_, next) => next({ seed: 2, value: 1 })))
  .use(middleware(async (ctx, next) =>
    next({ value: String(ctx.value), expected: ctx.seed + 1 })))
  .target(add)
  .it('ctxを順に拡張する', t => t.argsFrom(ctx => {
    expectType<string>(ctx.value)
    // @ts-expect-error context fields cannot be replaced directly.
    ctx.seed = 5
    return [ctx.seed, 1]
  }).expect(e => [e.result.toBe(e.ctx.expected)]))

new Test().target('加算', add).use(middleware(async (_, next) => next({ seed: 2 })))
  .it('期待のctxも同じ', t => t.args(1, 2).expect(e => {
    // @ts-expect-error expectations cannot replace context fields either.
    e.ctx.seed = 3
    return [e.result.toBe(e.ctx.seed + 1)]
  }))

declare const choose: boolean
new Test().use(middleware(async (_, next) => next({ value: 1 })))
  .use(middleware(async (_, next): Promise<MiddlewareResult<{ value: string } | { extra: boolean }>> =>
    next(choose ? { value: 'one' } : { extra: true })))
  .target((value: string | number) => String(value).length)
  .it('条件付きの置き換え', t => t.argsFrom(ctx => {
    expectType<string | number>(ctx.value)
    // @ts-expect-error conditional replacement cannot keep the old value type.
    expectType<number>(ctx.value)
    return [ctx.value]
  }).expect(e => [e.result.toBe(1)]))

const blueprint = registrations.blueprint()
expectType<'definition'>(blueprint.kind)
// @ts-expect-error a definition container is not a named group.
blueprint.name
for (const entry of blueprint.children) {
  expectType<'group'>(entry.kind)
  expectType<string | null>(entry.name)
  expectType<Function | null>(entry.middleware?.run ?? null)
  for (const childEntry of entry.children) {
    expectType<GroupEntry>(childEntry)
    // @ts-expect-error the name belongs to the group, not its placement in the parent.
    childEntry.name
  }
}
const result = await run(registrations)
expectType<'passed' | 'failed' | 'cancelled'>(result.status)
for (const node of result.tests) {
  // @ts-expect-error aggregate status is derived from cases or children, not stored.
  node.status
  if (node.kind === 'group') {
    expectType<string | null>(node.name)
    expectType<number>(node.origin.line)
    expectType<GroupMiddlewareResult | null>(node.middleware)
    expectType<readonly unknown[]>(node.children)
  }
  else expectType<readonly unknown[]>(node.cases)
}


interface SharedServer { close(): Promise<void>; readonly port: number }
declare function startServer(): Promise<SharedServer>

const groupScopedChild = new Test<{ server: SharedServer }>()
  .target((server: SharedServer) => server.port)
  .it('group middlewareのctxを使う', t => t.argsFrom(ctx => [ctx.server])
    .expect(e => [e.result.toBe(e.ctx.server.port)]))

const sharedServer = middleware(async (_, next) => {
  const server = await startServer()
  try {
    return await next({ server })
  } finally {
    await server.close()
  }
}, { timeout: 60_000 })

const groupedWithMiddleware = new Test()
  .group(sharedServer, [groupScopedChild])
  .group('名前付き', sharedServer, [groupScopedChild])
  .group('複数の子で資源を共有', sharedServer, [groupScopedChild, independent])
run(groupedWithMiddleware)
// @ts-expect-error middleware groups also require an array.
new Test().group(sharedServer, groupScopedChild)

// @ts-expect-error group middleware must supply the child's required context.
new Test().group(middleware(async (_, next) => next({ other: true })), [groupScopedChild])
// @ts-expect-error named group middleware has the same context contract.
new Test().group('不足', middleware(async (_, next) => next({ other: true })), [groupScopedChild])
// @ts-expect-error every child in the middleware group must receive its required context.
new Test().group(sharedServer, [independent, child])

const groupScopedCombinedChild = new Test<{ seed: number; server: SharedServer }>()
  .target((seed: number, server: SharedServer) => seed + server.port)
  .it('親attempt ctxとgroup ctxを合わせる', t => t.argsFrom(ctx => [ctx.seed, ctx.server])
    .expect(e => [e.result.toBe(e.ctx.seed + e.ctx.server.port)]))

new Test()
  .use(middleware(async (_, next) => next({ seed: 1 })))
  .group(middleware(async (ctx, next) => {
    // @ts-expect-error per-attempt fields do not exist before the group middleware starts.
    ctx.seed
    const server = await startServer()
    try {
      return await next({ server })
    } finally {
      await server.close()
    }
  }), [groupScopedCombinedChild])
for (const entry of groupedWithMiddleware.blueprint().children) {
  if (entry.middleware) {
    expectType<Function>(entry.middleware.run)
    expectType<number | undefined>(entry.middleware.timeout)
  }
}
