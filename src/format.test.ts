import { expect, test } from 'vite-plus/test'
import { diagnostic } from './diagnostic.js'
import { formatValue } from './format.js'

test('primitives keep their kind visible instead of collapsing into one text form', () => {
  expect(formatValue(diagnostic(undefined))).toBe('undefined')
  expect(formatValue(diagnostic(null))).toBe('null')
  expect(formatValue(diagnostic(true))).toBe('true')
  expect(formatValue(diagnostic(42))).toBe('42')
  expect(formatValue(diagnostic(NaN))).toBe('NaN')
  expect(formatValue(diagnostic(-0))).toBe('-0')
  expect(formatValue(diagnostic(-Infinity))).toBe('-Infinity')
  expect(formatValue(diagnostic(7n))).toBe('7')
  expect(formatValue(diagnostic('text'))).toBe('"text"')
  expect(formatValue(diagnostic(Symbol('tag')))).toBe('Symbol(tag)#1')
  expect(formatValue(diagnostic(Symbol()))).toBe('Symbol()#1')
})

test('arrays show holes and nested values in place', () => {
  const sparse = [1, 2, 3]
  Reflect.deleteProperty(sparse, 1)
  expect(formatValue(diagnostic(sparse))).toBe('[1, <hole>, 3]')
  expect(formatValue(diagnostic([['a'], { b: 1 }]))).toBe('[["a"], { b: 1 }]')
  expect(formatValue(diagnostic([]))).toBe('[]')
})

test('collections and opaque values name themselves', () => {
  expect(formatValue(diagnostic(new Map([['a', 1]])))).toBe('Map("a" => 1)')
  expect(formatValue(diagnostic(new Set([1, 2])))).toBe('Set(1, 2)')
  expect(formatValue(diagnostic(new Date('2020-01-02T03:04:05.000Z')))).toBe('Date(2020-01-02T03:04:05.000Z)')
  expect(formatValue(diagnostic(new Date(NaN)))).toBe('Date(Invalid)')
  expect(formatValue(diagnostic(/ab+c/gi))).toBe('/ab+c/gi')
  expect(formatValue(diagnostic(function named() {}))).toBe('[Function named]')
})

test('errors read as message lines and never expose the stack', () => {
  expect(formatValue(diagnostic(new Error('boom')))).toBe('Error: boom')
  expect(formatValue(diagnostic(new RangeError('out of range')))).toBe('RangeError: out of range')
  expect(formatValue(diagnostic(new Error('')))).toBe('Error')
})

test('error causes are appended and nest through their own message lines', () => {
  const error = new Error('outer', { cause: new TypeError('inner') })
  expect(formatValue(diagnostic(error))).toBe('Error: outer (cause: TypeError: inner)')
  expect(formatValue(diagnostic(new Error('wrapped', { cause: 'plain' })))).toBe('Error: wrapped (cause: "plain")')
})

test('objects that merely look like errors keep the property listing', () => {
  expect(formatValue(diagnostic({ name: 'a', message: 'b' }))).toBe('{ name: "a", message: "b" }')
  expect(formatValue(diagnostic({ a: 1, b: 'x' }))).toBe('{ a: 1, b: "x" }')
  expect(formatValue(diagnostic(new (class Box {})()))).toBe('Box{  }')
  expect(formatValue(diagnostic({ [Symbol('tag')]: 1 }))).toBe('{ Symbol(tag)#1: 1 }')
})

test('target outcomes say what the target did instead of dumping their shape', () => {
  expect(formatValue({ kind: 'throw', value: diagnostic(new Error('boom')) })).toBe('threw Error: boom')
  expect(formatValue({ kind: 'return', value: diagnostic(42) })).toBe('returned 42')
  expect(formatValue({ kind: 'return', value: diagnostic(undefined) })).toBe('returned undefined')
})

test('the expected outcome kind uses the same words as the actual outcome', () => {
  expect(formatValue('return')).toBe('returned')
  expect(formatValue('throw')).toBe('threw')
})

test('cycles resolve to the id of the value that already appeared', () => {
  const circular: { self?: object } = {}
  circular.self = circular
  expect(formatValue(diagnostic(circular))).toBe('{ self: [Reference #1] }')
  const pair: object[] = []
  pair.push(pair, pair)
  expect(formatValue(diagnostic(pair))).toBe('[[Reference #1], [Reference #1]]')
})

test('values that cannot be inspected report why they were dropped', () => {
  const hostile = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('inspection exploded')
      },
    },
  )
  expect(formatValue(diagnostic(hostile))).toBe('[omitted: inspection failed: inspection exploded]')
})
