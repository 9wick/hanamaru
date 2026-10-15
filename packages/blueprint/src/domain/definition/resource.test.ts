import { expect, test } from 'vite-plus/test'
import { resource } from '../../interfaces/library/resource.js'
import { resourceGraph } from './resource.js'
import type { Resource } from './resource.js'

test('validates cycles and scope dependencies before any setup side effects', () => {
  let calls = 0
  const worker = resource({
    scope: 'perWorker',
    async setup(_, next) {
      calls++
      return await next()
    },
  })
  const run = resource({
    scope: 'perRun',
    require: [worker],
    async setup(_, next) {
      calls++
      return await next()
    },
  })
  expect(() => resourceGraph([run])).toThrow('cannot require perWorker')
  const deps: Resource[] = []
  const circular: Resource = { ...worker, require: deps }
  deps.push(circular)
  expect(() => resourceGraph([circular])).toThrow('cyclic resource')
  expect(calls).toBe(0)
})

test('definition identity controls singleton sharing, even when names are equal', () => {
  const make = () =>
    resource({
      name: 'same',
      scope: 'perRun',
      async setup(_, next) {
        return await next()
      },
    })
  const a = make(),
    b = make()
  expect(resourceGraph([a, b, a])).toEqual([a, b])
})
