import { Test, run } from 'hanamaru'
import type { TestDefinition, TestPlan } from 'hanamaru'
import { add } from '../examples/math.ts'
import { mailService } from '../examples/user.ts'
import { registrations } from '../examples/groups.test.ts'

declare function expectType<T>(value: T): void

const child = new Test<{ seed: number }>()
  .setup(ctx => {
    expectType<number>(ctx.seed)
    return { expected: ctx.seed + 1 }
  }, ctx => {
    expectType<number>(ctx.seed)
    expectType<number>(ctx.expected)
  })
  .target(add)
  .it('親のctxから準備する', t => t.argsFrom(ctx => [ctx.seed, 1])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

const parent = new Test()
  .setup(async () => ({ seed: 2, extra: true }))
  .group(child)
  .group('同じ子をもう一度使う', child)
run(parent.plan())
run([parent.plan(), registrations.plan()])

const nested = new Test<{ seed: number }>().group(child)
run(new Test().setup(() => ({ seed: 3 })).group(nested).plan())
const independent = new Test().target(add)
  .it('ctxを要求しない', t => t.args(1, 2).expect(e => [e.result.toBe(3)]))
new Test().group(independent)
new Test().setup(() => ({ seed: 1 })).group(independent)
new Test().describe('準備を共有する')
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group(independent)
new Test().mock(mailService, 'send', m => m.resolves(undefined))
  .target(add).todo('対象の前にも共通設定を書ける')
const annotated: TestDefinition<{ seed: number }> = child
new Test().setup(() => ({ seed: 1 })).group(annotated)

// @ts-expect-error the parent must supply the child's required context.
new Test().group(child)
// @ts-expect-error named groups must enforce the same requirement.
new Test().group('不足', child)
// @ts-expect-error a field with the wrong type cannot satisfy the child.
new Test().setup(() => ({ seed: '2' })).group(child)
// @ts-expect-error an optional field cannot satisfy a required field.
new Test().setup((): { seed?: number } => ({})).group(child)
// @ts-expect-error nesting cannot discard the context requirement.
new Test().group(nested)
// @ts-expect-error type annotations must not erase required context.
const erasedDefinition: TestDefinition = child
// @ts-expect-error the child cannot run without its parent.
run(child.plan())
// @ts-expect-error arrays cannot hide a missing context provider.
run([independent.plan(), child.plan()])
// @ts-expect-error a group's declared input is still required at the root.
run(nested.plan())
// @ts-expect-error type annotations must not erase plan requirements.
const erasedPlan: TestPlan = child.plan()
// @ts-expect-error even locally shadowing an input does not remove an input contract.
run(new Test<{ seed: number }>().setup(() => ({ seed: 1 })).target(add).todo('後で').plan())
// @ts-expect-error extracted child nodes cannot be run outside their context.
run(parent.plan().children[0].plan)

// @ts-expect-error setup is fixed after composition starts.
parent.setup(() => ({ seed: 4 }))
// @ts-expect-error mock scope is fixed after composition starts.
parent.mock(mailService, 'send', m => m.resolves(undefined))
// @ts-expect-error descriptions are also fixed after the first group.
parent.describe('変更')
// @ts-expect-error a group is a container; targets belong to its children.
parent.target(add)
// @ts-expect-error a group does not declare cases without a target.
parent.it('対象なし', () => {})
// @ts-expect-error an empty container is not a finished definition.
new Test().group(new Test())
// @ts-expect-error a configured target needs at least one case.
new Test().group(new Test().target(add))
// @ts-expect-error an empty container cannot produce a plan.
new Test().plan()
// @ts-expect-error group names are strings when present.
new Test().group(123, independent)
// @ts-expect-error metadata structure is readonly.
parent.plan().children.push({ name: null, plan: independent.plan() })

// Each setup receives the accumulated context; later fields replace earlier ones.
new Test()
  .setup(() => ({ seed: 2, value: 1 }), ctx => {
    expectType<number>(ctx.value)
    // @ts-expect-error earlier cleanup cannot see a later setup's fields.
    ctx.expected
  })
  .setup(async ctx => ({ value: String(ctx.value), expected: ctx.seed + 1 }), ctx => {
    expectType<string>(ctx.value)
    expectType<number>(ctx.seed)
    expectType<number>(ctx.expected)
  })
  .target(add)
  .it('ctxを順に拡張する', t => t.argsFrom(ctx => {
    expectType<string>(ctx.value)
    // @ts-expect-error context fields cannot be replaced directly.
    ctx.seed = 5
    return [ctx.seed, 1]
  }).expect(e => [e.result.toBe(e.ctx.expected)]))

// @ts-expect-error setup must return an object containing context fields.
new Test().setup(() => 1)
// @ts-expect-error awaiting setup must also produce an object.
new Test().setup(async () => 'wrong')
new Test().setup(() => ({ seed: 2 })).setup(ctx => {
  // @ts-expect-error fields must be added through a return value.
  ctx.seed = 3
  return { next: ctx.seed + 1 }
})
new Test().setup(() => ({ seed: 2 }), ctx => {
  // @ts-expect-error cleanup sees readonly context fields.
  ctx.seed = 3
})
new Test().target(add).setup(() => ({ seed: 2 }))
  .it('期待のctxも同じ', t => t.args(1, 2).expect(e => {
    // @ts-expect-error expectations cannot replace context fields either.
    e.ctx.seed = 3
    return [e.result.toBe(e.ctx.seed + 1)]
  }))

declare const choose: boolean
new Test().setup(() => ({ value: 1 }))
  .setup((): { value: string } | { extra: boolean } => choose ? { value: 'one' } : { extra: true })
  .setup(ctx => {
    expectType<string | number>(ctx.value)
    // @ts-expect-error conditional replacement cannot keep the old value type.
    expectType<number>(ctx.value)
    return {}
  })

const plan = registrations.plan()
expectType<'group'>(plan.kind)
expectType<string | null>(plan.name)
for (const entry of plan.children) {
  expectType<string | null>(entry.name)
  if (entry.plan.kind === 'test') {
    expectType<readonly unknown[]>(entry.plan.cases)
  } else {
    expectType<readonly unknown[]>(entry.plan.children)
  }
}
const result = await run(plan)
for (const node of result.tests) {
  if (node.kind === 'group') expectType<readonly unknown[]>(node.children)
  else expectType<readonly unknown[]>(node.cases)
}
