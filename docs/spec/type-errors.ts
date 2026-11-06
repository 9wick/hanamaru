import { Test, middleware, environment, registerTest, integers, strings, tuples, constant, scenario, method } from 'hanamaru'
import { add } from '../examples/math.ts'
import type { Ref } from 'hanamaru'

const ready = new Test().target(add)
const suite = ready.it('足す', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
registerTest(suite)
// @ts-expect-error target is fixed once selected.
ready.target((s: string) => s)
// @ts-expect-error completed suites cannot change context.
suite.use(middleware(async (_, next) => next({ value: 1 })))
// @ts-expect-error incomplete definitions cannot be registered.
registerTest(ready)
// @ts-expect-error target must precede cases.
new Test().it('missing', () => {})
// @ts-expect-error arguments precede expectations.
ready.it('missing args', t => t.expect(e => [e.result.toEqual(3)]))
// @ts-expect-error argument types come from the target.
ready.it('wrong input', t => t.args('1', 2).expect(e => [e.result.toEqual(3)]))
// @ts-expect-error arguments can only be selected once.
ready.it('twice', t => t.args(1, 2).args(3, 4).expect(e => [e.result.toEqual(3)]))
// @ts-expect-error expectations retain the target result type.
ready.it('wrong expected', t => t.args(1, 2).expect(e => [e.result.toEqual('3')]))
// @ts-expect-error expectations must be nonempty.
ready.it('empty', t => t.args(1, 2).expect(() => []))
// @ts-expect-error expectation builders are synchronous.
ready.it('async', t => t.args(1, 2).expect(async e => [e.result.toEqual(3)]))
// @ts-expect-error a single target example cannot use steps.
ready.it('steps', t => t.steps(() => ({})))
// @ts-expect-error arbitrary method replacement is not available.
ready.mock({ add }, 'add', () => undefined)
// @ts-expect-error call recording is supplied by environment observations.
ready.it('calls', t => t.args(1, 2).expectCalls(() => []))
// @ts-expect-error examples have no general negation.
ready.it('not', t => t.args(1, 2).expect(e => [e.result.not.toEqual(0)]))
// @ts-expect-error arbitrary predicates belong to property cases.
ready.it('predicate', t => t.args(1, 2).expect(e => [e.on(e.result).satisfies('positive', n => n > 0)]))
// @ts-expect-error normal and exceptional expectations cannot coexist.
ready.it('mixed', t => t.args(1, 2).expect(e => [e.result.toEqual(3), e.error.message.toEqual('bad')]))
// @ts-expect-error a declared characteristic cannot be switched.
ready.pure().effectful()
// @ts-expect-error characteristic cannot be changed after cases.
suite.effectful()

const numeric = new Test().target((n: number) => n)
numeric.property('finite', p => p.forAll(tuples(integers())).expect(e => [e.on(e.result).satisfies('finite', Number.isFinite)]))
// @ts-expect-error forAll is required before expectations.
numeric.property('no source', p => p.expect(() => []))
// @ts-expect-error generated input must match target parameters without an explicit binding.
numeric.property('wrong tuple', p => p.forAll(tuples(strings())).expect(e => [e.result.toEqual(1)]))
numeric.property('bound input', p => p.forAll(tuples(strings())).argsFrom((_, sample) => [sample[0].length]).expect(e => [e.on(e.result).satisfies('nonnegative', n => n >= 0)]))
// @ts-expect-error argsFrom must return target parameters.
numeric.property('wrong binding', p => p.forAll(tuples(strings())).argsFrom((_, sample) => [sample[0]]))
// @ts-expect-error predicates must return a synchronous boolean.
numeric.property('async predicate', p => p.forAll(tuples(integers())).expect(e => [e.on(e.result).satisfies('async', async () => true)]))
// @ts-expect-error named reference records must not be empty.
numeric.property('empty refs', p => p.forAll(tuples(integers())).expect(e => [e.on({}).satisfies('empty', () => true)]))
// @ts-expect-error raw outcome must be narrowed or projected before on.
numeric.property('raw exit', p => p.forAll(tuples(integers())).expect(e => [e.on(e.outcome).satisfies('raw', () => true)]))
// @ts-expect-error outcome cannot coexist with a normal-only expectation.
numeric.property('mixed exit', p => p.forAll(tuples(integers())).expect(e => [e.result.toEqual(1), e.on(e.outcome.field('kind')).satisfies('exit', kind => kind === 'return')]))
// @ts-expect-error snapshot identity is not the identity of a live result.
numeric.property('sample identity', p => p.forAll(tuples(integers())).expect(e => [e.on(e.identity(e.sample(0))).satisfies('identity', () => true)]))
// @ts-expect-error projected data cannot recover live reference identity.
numeric.property('projected identity', p => p.forAll(tuples(integers())).expect(e => [e.on(e.identity(e.project(e.result, n => ({ n })))).satisfies('identity', () => true)]))
// @ts-expect-error projected fields also retain their snapshot provenance.
numeric.property('projected field identity', p => p.forAll(tuples(integers())).expect(e => [e.on(e.identity(e.project(e.result, n => ({ n })).field('n'))).satisfies('identity', () => true)]))

const local = environment(async (_, scope, next) => next({
  saved: scope.state({ evidence: 'real-effect', read: (id: string) => ({ id, count: 1 }) }),
  events: scope.action<number>({ evidence: 'real-effect', open: () => ({ finish: () => [], dispose: () => {} }) }),
}))
// @ts-expect-error pure targets cannot install an environment.
numeric.use(local)
const effective = new Test().target((id: string) => ({ id })).effectful().use(local)
effective.it('saved', t => t.args('u1').expect(e => [e.state(e.ctx.saved, e.result.field('id')).part('count').toEqual(1)]))
// @ts-expect-error observation parameters retain their declared type.
effective.it('wrong key', t => t.args('u1').expect(e => [e.state(e.ctx.saved, 1).toEqual({ id: 'u1', count: 1 })]))
// @ts-expect-error state cannot be replaced by a case-provided read function.
effective.it('forged observation', t => t.args('u1').expect(e => [e.state(() => 1).toEqual(1)]))
// @ts-expect-error state identity is not meaningful for saved values.
effective.it('state identity', t => t.args('u1').expect(e => [e.state(e.ctx.saved, 'u1').toBe({ id: 'u1', count: 1 })]))
// @ts-expect-error examples do not expose before refs.
effective.it('before', t => t.args('u1').expect(e => [e.state(e.ctx.saved, 'u1').before()]))
// @ts-expect-error eventually is a standalone condition, not an unchanged check.
effective.it('eventually', t => t.args('u1').expect(e => [e.state(e.ctx.saved, 'u1').eventually({ withinMs: 10, intervalMs: 1 }).unchanged()]))
// @ts-expect-error action windows must be selected before checks.
effective.it('window', t => t.args('u1').expect(e => [e.action(e.ctx.events).count(1)]))
// @ts-expect-error action history expectations preserve event types.
effective.it('event type', t => t.args('u1').expect(e => [e.action(e.ctx.events).untilTargetSettles().toEqual(['event'])]))
// @ts-expect-error property cannot observe state identity.
effective.property('state ref identity', p => p.forAll(tuples(constant('u1'))).expect(e => [e.on(e.identity(e.state(e.ctx.saved, 'u1'))).satisfies('identity', () => true)]))

class Service { create(name: string) { return { id: name } } }
const pending = new Test().target(Service, 'create')
// @ts-expect-error a class target needs a receiver before cases.
pending.it('unbound', t => t.args('a').expect(e => [e.result.toEqual({ id: 'a' })]))
const bound = pending.from(() => new Service())
// @ts-expect-error receiver cannot be supplied twice.
bound.from(() => new Service())
bound.it('bound', t => t.args('a').expect(e => [e.result.part('id').toEqual('a')]))
// @ts-expect-error target keys must identify methods on the instance.
new Test().target(Service, 'missing')
const collection = new Test().target(scenario({ create: method(Service, 'create') }))
// @ts-expect-error every declared class method requires its receiver.
collection.from(() => ({}))
collection.from(() => ({ create: new Service() })).it('create', t => t.steps(s => s.create.args('a')).expect(e => [e.result.toEqual({ id: 'a' })]))
// @ts-expect-error arbitrary receivers cannot erase the declared class interface.
collection.from(() => ({ create: { different: () => 1 } }))

numeric.property('projection cannot become live by annotation', p => p.forAll(tuples(integers())).expect(e => {
  const projected = e.project(e.result, n => ({ n }))
  // @ts-expect-error a projection cannot be assigned to a live result ref.
  const live: Ref<{ n: number }, 'result'> = projected
  void live
  return [e.on(projected).satisfies('number', data => Number.isFinite(data.n))]
}))
// @ts-expect-error exception refs must be narrowed before use as property data.
numeric.property('raw error', p => p.forAll(tuples(integers())).expect(e => [e.on(e.error).satisfies('untyped', () => true)]))
// @ts-expect-error a named record cannot bypass exception narrowing.
numeric.property('raw error record', p => p.forAll(tuples(integers())).expect(e => [e.on({ error: e.error }).satisfies('untyped', () => true)]))
// @ts-expect-error project on an exception also requires a type restriction; raw exits use outcome.
numeric.property('raw error project', p => p.forAll(tuples(integers())).expect(e => [e.on(e.project(e.error, () => true)).satisfies('untyped', n => n)]))
// @ts-expect-error case settings are selected before arguments.
ready.it('late timeout', t => t.args(1, 2).timeout(10).expect(e => [e.result.toEqual(3)]))
// @ts-expect-error property settings precede forAll.
numeric.property('late retry', p => p.forAll(tuples(integers())).retry(1).expect(e => [e.result.toEqual(1)]))
// @ts-expect-error settings cannot be reintroduced after a steps plan.
new Test().target(scenario({ add })).it('late steps setting', t => t.steps(s => s.add.args(1, 2)).timeout(10).expect(e => [e.result.toEqual(3)]))
// @ts-expect-error result-dependent state requires normal termination, even alongside error conditions.
effective.it('state result/error mix', t => t.args('u1').expect(e => [e.error.message.toEqual('bad'), e.state(e.ctx.saved, e.result.field('id')).toEqual({ id: 'u1', count: 1 })]))
// @ts-expect-error partial state conditions retain the dependency requirement.
effective.it('state part/error mix', t => t.args('u1').expect(e => [e.error.message.toEqual('bad'), e.state(e.ctx.saved, e.result.field('id')).part('count').toEqual(1)]))
// @ts-expect-error property predicates retain normal-result dependencies of observed state.
effective.property('state predicate/error mix', p => p.forAll(tuples(constant('u1'))).expect(e => [e.error.message.toEqual('bad'), e.on(e.state(e.ctx.saved, e.result.field('id'))).satisfies('saved', state => state.count === 1)]))
// @ts-expect-error single-run results are not step checkpoints.
effective.it('single checkpoint', t => t.args('u1').expect(e => [e.state(e.ctx.saved, 'u1').after(e.result).part('count').toEqual(1)]))
// @ts-expect-error a complete result record is not one operation checkpoint.
effective.property('record checkpoint', p => p.forAll(tuples(constant('u1'))).steps(s => ({ first: s.target.args(s.input[0]) })).expect(e => [e.state(e.ctx.saved, 'u1').after(e.result).part('count').toEqual(1)]))
// @ts-expect-error the explicitly final operation is not an after checkpoint.
effective.property('final checkpoint', p => p.forAll(tuples(constant('u1'))).steps(s => s.target.final(s.input[0])).expect(e => [e.state(e.ctx.saved, 'u1').after(e.result).part('count').toEqual(1)]))
// @ts-expect-error virtual result records do not have live reference identity.
numeric.property('record identity', p => p.forAll(tuples(integers())).steps(s => ({ value: s.target.args(s.input[0]) })).expect(e => [e.on(e.identity(e.result)).satisfies('identity', () => true)]))
// @ts-expect-error record toBe would assert identity of a synthetic wrapper, not a target result.
numeric.property('record toBe', p => p.forAll(tuples(integers())).steps(s => ({ value: s.target.args(s.input[0]) })).expect(e => [e.result.toBe({ value: 1 })]))
const prefixState = new Test<{ read: import('hanamaru').State<(id: string) => number> }>()
  .target(scenario({ identify: (id: string) => id, fail: (): never => { throw new Error('bad') } })).effectful()
prefixState.it('prefix state and final error', t => t.steps(s => ({ id: s.identify.args('u1'), failed: s.fail.final() }))
  .expect(e => [e.state(e.ctx.read, e.result.field('id')).toEqual(1), e.error.message.toEqual('bad')]))
// @ts-expect-error a state dependency cannot be hidden inside one named predicate record.
effective.property('mixed state record', p => p.forAll(tuples(constant('u1'))).expect(e => [e.on({ saved: e.state(e.ctx.saved, e.result.field('id')), error: e.error.ofType(Error).field('message') }).satisfies('mixed', () => true)]))
const objectReads = environment(async (_, scope, next) => next({ read: scope.state({ evidence: 'real-effect', read: (_value: object) => 1 }) }))
// @ts-expect-error object-valued result refs retain their dependency even though object inputs are accepted.
new Test().target(() => ({ id: 1 })).effectful().use(objectReads).it('object dependency', t => t.args().expect(e => [e.error.message.toEqual('bad'), e.state(e.ctx.read, e.result).toEqual(1)]))

// @ts-expect-error result-dependent observations cannot read a baseline.
effective.property('result before', p => p.forAll(tuples(constant('u1'))).expect(e => [e.on(e.state(e.ctx.saved, e.result.field('id')).before()).satisfies('saved', () => true)]))
// @ts-expect-error unchanged needs arguments available before execution.
effective.it('result unchanged', t => t.args('u1').expect(e => [e.state(e.ctx.saved, e.result.field('id')).unchanged()]))
effective.property('checkpoint selection', p => p.forAll(tuples(constant('u1'))).steps(s => ({ first: s.target.args(s.input[0]) })).expect(e => {
  const checkpoint = e.state(e.ctx.saved, 'u1').after(e.result.field('first'))
  // @ts-expect-error a checkpoint cannot be replaced with before.
  checkpoint.before()
  // @ts-expect-error a checkpoint cannot be selected twice.
  checkpoint.after(e.result.field('first'))
  // @ts-expect-error eventually cannot change a checkpoint's observation window.
  checkpoint.eventually({ withinMs: 10, intervalMs: 1 })
  return [checkpoint.unchanged()]
}))
