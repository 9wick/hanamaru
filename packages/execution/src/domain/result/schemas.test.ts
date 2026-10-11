import { expect, test } from 'vite-plus/test'
import * as v from 'valibot'
import { diagnosticSchema, runResultSchema } from './schemas.js'

// transportの入力検査は所有するschemaのunit契約。E2Eの判定にはこのschemaを使わない。
test('the result schema accepts a transport result and rejects malformed headers and nodes', () => {
  const result = { version: 1, status: 'passed', reason: 'completed', tests: [] }
  expect(v.safeParse(runResultSchema, result).success).toBe(true)
  for (const input of [
    { ...result, version: 2 },
    { ...result, status: 'unknown' },
    { ...result, tests: null },
    { ...result, tests: [{ kind: 'test', name: 'missing case data', path: [], cases: [{}] }] },
  ])
    expect(v.safeParse(runResultSchema, input).success).toBe(false)
})

test('diagnostic transport values require the fields of their declared kind', () => {
  expect(v.safeParse(diagnosticSchema, { kind: 'number', value: 'NaN' }).success).toBe(true)
  expect(v.safeParse(diagnosticSchema, { kind: 'number', value: 'unknown' }).success).toBe(false)
  expect(v.safeParse(diagnosticSchema, { kind: 'array', id: 1, items: [], properties: [] }).success).toBe(true)
  expect(v.safeParse(diagnosticSchema, { kind: 'array', id: 1, items: [{}], properties: [] }).success).toBe(false)
})
