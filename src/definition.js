import {
  assertionTag,
  behaviorTag,
  definitionTag,
  doneTag,
  location,
  methodValue,
  middlewareTag,
  positive,
  retryCount,
} from './shared.js'

function assertion(subject, check, extra = {}) {
  return { [assertionTag]: true, subject, check, ...extra }
}
function valueAssertions(subject) {
  return {
    toBe: (value) => assertion(subject, { matcher: 'toBe', expected: value }),
    toEqual: (value) => assertion(subject, { matcher: 'toEqual', expected: value }),
    toMatchObject: (value) => assertion(subject, { matcher: 'toMatchObject', expected: value }),
    toSatisfy: (predicate) => assertion(subject, { matcher: 'toSatisfy', predicate }),
    toBeInstanceOf: (ctor) => assertion(subject, { matcher: 'toBeInstanceOf', ctor }),
    toThrow: (message) => assertion(subject, { matcher: 'toThrow', message }),
  }
}
function callBuilder(object, key) {
  const item = (matcher, details = {}) => assertion('call', { matcher, ...details }, { object, key })
  return {
    calledTimes: (count) => item('calledTimes', { count }),
    notCalled: () => item('notCalled'),
    calledWith: (...args) => item('calledWith', { args }),
    calledOnceWith: (...args) => item('calledOnceWith', { args }),
    calledNthWith: (n, ...args) => item('calledNthWith', { n, args }),
  }
}
function validateCalls(calls) {
  if (!Array.isArray(calls) || !calls.length || calls.some((x) => x?.[assertionTag] !== true || x.subject !== 'call')) {
    throw new TypeError('expectCalls must return a nonempty array of call assertions')
  }
  for (const item of calls) {
    if (typeof item.key !== 'string') throw new TypeError('call target must be a method')
    methodValue(item.object, item.key)
    if (item.check.matcher === 'calledNthWith' && (!Number.isSafeInteger(item.check.n) || item.check.n < 1))
      throw new TypeError('calledNthWith index must be positive')
    if (item.check.matcher === 'calledTimes' && (!Number.isSafeInteger(item.check.count) || item.check.count < 0))
      throw new TypeError('calledTimes count must be nonnegative')
  }
  return calls
}
function behaviorBuilder(once = []) {
  const action = (kind, field, value) => ({ [behaviorTag]: true, kind, ...(field ? { [field]: value } : {}) })
  const add = (kind, field, value) => behaviorBuilder([...once, action(kind, field, value)])
  const finish = (kind, field, value) => {
    const fallback = action(kind, field, value)
    return once.length ? { [behaviorTag]: true, kind: 'sequence', once, fallback } : fallback
  }
  return {
    returnsOnce: (value) => add('returns', 'value', value),
    resolvesOnce: (value) => add('resolves', 'value', value),
    throwsOnce: (error) => add('throws', 'error', error),
    rejectsOnce: (error) => add('rejects', 'error', error),
    callsFakeOnce: (fn) => add('callsFake', 'fn', fn),
    returns: (value) => finish('returns', 'value', value),
    resolves: (value) => finish('resolves', 'value', value),
    throws: (error) => finish('throws', 'error', error),
    rejects: (error) => finish('rejects', 'error', error),
    callsFake: (fn) => finish('callsFake', 'fn', fn),
  }
}
function createMock(object, key, def) {
  if (typeof key !== 'string') throw new TypeError('mock target must be a method')
  methodValue(object, key)
  const behavior = def(behaviorBuilder())
  if (behavior?.[behaviorTag] !== true) throw new TypeError('mock builder must return a completed behavior')
  return { object, key, behavior }
}
function mergeMock(mocks, mock) {
  const index = mocks.findIndex((item) => item.object === mock.object && item.key === mock.key)
  const copy = [...mocks]
  if (index < 0) copy.push(mock)
  else copy[index] = mock
  return copy
}
export function middleware(fn, options = {}) {
  if (typeof fn !== 'function') throw new TypeError('middleware requires a function')
  const timeout = options.timeout === undefined ? undefined : positive(options.timeout, 'middleware timeout')
  return Object.freeze({ [middlewareTag]: true, kind: 'middleware', run: fn, timeout })
}

class CaseBuilder {
  constructor(data) {
    this.data = data
    if (data[doneTag]) this[doneTag] = true
  }
  copy(patch) {
    return new CaseBuilder({ ...this.data, ...patch })
  }
  timeout(ms) {
    return this.copy({ config: { ...this.data.config, timeout: positive(ms, 'timeout') } })
  }
  retry(count) {
    return this.copy({ config: { ...this.data.config, retry: retryCount(count) } })
  }
  mock(object, key, def) {
    return this.copy({ mocks: mergeMock(this.data.mocks, createMock(object, key, def)) })
  }
  args(...args) {
    return this.copy({ args: { kind: 'value', value: args } })
  }
  argsFrom(build) {
    return this.copy({ args: { kind: 'from-context', build } })
  }
  expect(build) {
    if (this.data.expect) throw new TypeError('expect already set')
    return this.copy({
      [doneTag]: true,
      expect: {
        kind: 'deferred',
        build: (ctx) => build({ result: valueAssertions('result'), error: valueAssertions('error'), ctx }),
      },
    })
  }
  expectCalls(build) {
    if (this.data.calls.length) throw new TypeError('expectCalls already set')
    return this.copy({ [doneTag]: true, calls: validateCalls(build(callBuilder)) })
  }
}

export class Test {
  constructor(data = null) {
    this.data = data ?? {
      stage: 'base',
      config: {},
      steps: [],
      mocks: [],
      groups: [],
      cases: [],
      target: null,
      name: null,
    }
    if (data?.stage === 'group' || data?.stage === 'suite') this[definitionTag] = true
  }
  copy(patch) {
    return new Test({ ...this.data, ...patch })
  }
  settingAllowed() {
    if (this.data.stage === 'group' || this.data.stage === 'suite')
      throw new TypeError('common settings are fixed after the first group or case')
  }
  timeout(ms) {
    this.settingAllowed()
    return this.copy({ config: { ...this.data.config, timeout: positive(ms, 'timeout') } })
  }
  retry(count) {
    this.settingAllowed()
    return this.copy({ config: { ...this.data.config, retry: retryCount(count) } })
  }
  use(step) {
    this.settingAllowed()
    if (step?.[middlewareTag] !== true) throw new TypeError('use requires middleware()')
    return this.copy({ steps: [...this.data.steps, step] })
  }
  mock(object, key, def) {
    this.settingAllowed()
    return this.copy({ mocks: mergeMock(this.data.mocks, createMock(object, key, def)) })
  }
  target(...args) {
    if (this.data.stage !== 'base') throw new TypeError('target already selected')
    let name = null
    if (typeof args[0] === 'string' && args.length > 1) name = args.shift()
    let target
    if (args.length === 1 && typeof args[0] === 'function') target = { kind: 'function', fn: args[0] }
    else if (args.length === 2 && args[0] && typeof args[1] === 'string')
      target = { kind: 'method', object: args[0], key: args[1], fn: methodValue(args[0], args[1]) }
    else throw new TypeError('target requires a function or object method')
    return this.copy({
      stage: 'target',
      name: name ?? (target.kind === 'method' ? target.key : target.fn.name || '<anonymous>'),
      target,
    })
  }
  addCase(mode, name, body, row = null, origin = location()) {
    if (this.data.stage !== 'target' && this.data.stage !== 'suite') throw new TypeError('select target before cases')
    if (typeof name !== 'string') throw new TypeError('case name must be a string')
    let item
    if (mode === 'todo') item = { name, mode, origin, row: null, config: {} }
    else {
      const built = body(new CaseBuilder({ config: {}, mocks: [], args: null, expect: null, calls: [] }))
      if (
        !(built instanceof CaseBuilder) ||
        !built[doneTag] ||
        !built.data.args ||
        (!built.data.expect && !built.data.calls.length)
      )
        throw new TypeError('case must return args and an expectation')
      item = { name, mode, origin, row, ...built.data }
    }
    return this.copy({ stage: 'suite', cases: [...this.data.cases, item] })
  }
  it(name, body) {
    return this.addCase('run', name, body)
  }
  only(name, body) {
    return this.addCase('only', name, body)
  }
  skip(name, body) {
    return this.addCase('skip', name, body)
  }
  todo(name) {
    return this.addCase('todo', name)
  }
  each(name, rows, body) {
    if (!Array.isArray(rows) || rows.length === 0) throw new TypeError('each requires nonempty rows')
    const origin = location()
    return rows.reduce((test, row, index) => {
      const display = typeof name === 'function' ? name(row) : `${name} [${index + 1}]`
      return test.addCase('run', display, (t) => body(t, row), { index, value: row }, origin)
    }, this)
  }
  group(...args) {
    if (this.data.stage !== 'base' && this.data.stage !== 'group') throw new TypeError('group requires a group builder')
    const origin = location()
    let name = null
    if (typeof args[0] === 'string') name = args.shift()
    let step = null
    if (args[0]?.[middlewareTag] === true) step = args.shift()
    const [children] = args
    if (
      args.length !== 1 ||
      !Array.isArray(children) ||
      !children.length ||
      children.some((child) => child?.[definitionTag] !== true)
    )
      throw new TypeError('group requires completed children')
    const group = {
      version: 1,
      kind: 'group',
      name,
      origin,
      middleware: step,
      config: {},
      steps: [],
      mocks: [],
      children: children.map((child) => ({ origin, blueprint: child.blueprint() })),
    }
    return this.copy({ stage: 'group', groups: [...this.data.groups, group] })
  }
  blueprint() {
    const d = this.data
    if (d.stage === 'suite')
      return {
        version: 1,
        kind: 'test',
        name: d.name,
        target: d.target,
        cases: [...d.cases],
        config: { ...d.config },
        steps: [...d.steps],
        mocks: [...d.mocks],
      }
    if (d.stage === 'group')
      return {
        version: 1,
        kind: 'definition',
        config: { ...d.config },
        steps: [...d.steps],
        mocks: [...d.mocks],
        children: [...d.groups],
      }
    throw new TypeError('test definition is incomplete')
  }
}

export function isDefinition(value) {
  return value?.[definitionTag] === true
}
export function validateAssertion(value) {
  return value?.[assertionTag] === true
}
