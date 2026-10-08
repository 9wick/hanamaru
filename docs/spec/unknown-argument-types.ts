import { Test, middleware, registerTest, run } from 'hanamaru'
import type { TestBlueprint, TestDefinition } from 'hanamaru'

declare const input: unknown

const inspect = (value: unknown): string => typeof value
const suite = new Test().target(inspect)
  .it('unknown を直接渡す', t => t.args(input).expect(e => [e.result.toBe('object')]))
  .it('unknown を遅延して渡す', t => t.argsFrom(() => [input]).expect(e => [e.result.toBe('object')]))

registerTest(suite)
run(suite)
run([suite])
const definition: TestDefinition = suite
const blueprint: TestBlueprint = suite.blueprint()
void [definition, blueprint]

const grouped = new Test().group('unknown の対象', [suite])
registerTest(grouped)
run(grouped)

const mixed = new Test().target((prefix: string, value?: unknown): string => prefix + typeof value)
  .it('具体型と unknown を混ぜる', t => t.args('type:', input).expect(e => [e.result.toBe('type:object')]))
  .it('省略可能な unknown', t => t.args('type:').expect(e => [e.result.toBe('type:undefined')]))
registerTest(mixed)

const rest = new Test().target((...values: unknown[]): number => values.length)
  .it('unknown の可変長引数', t => t.args(input, null, undefined).expect(e => [e.result.toBe(3)]))
registerTest(rest)

const child = new Test<{ input: unknown }>().target(inspect)
  .it('親から unknown を受け取る', t => t.argsFrom(ctx => [ctx.input]).expect(e => [e.result.toBe('object')]))
const parent = new Test().use(middleware(async (_, next) => next({ input }))).group([child])
registerTest(parent)
run(parent)

// @ts-expect-error an unknown argument must not erase the other parameter types.
mixed.it('具体型への誤った引数', t => t.args(1, input).expect(e => [e.result.toBe('1object')]))
// @ts-expect-error a required unknown parameter cannot be omitted.
new Test().target(inspect).it('引数不足', t => t.args().expect(e => [e.result.toBe('undefined')]))
// @ts-expect-error an incomplete builder with an unknown argument cannot be registered.
registerTest(new Test().target(inspect))
// @ts-expect-error an unknown argument must not erase required parent context.
registerTest(child)
// @ts-expect-error an unknown argument must not erase required parent context at execution.
run(child)
