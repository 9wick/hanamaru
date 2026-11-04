import { expect, test } from 'vite-plus/test'
import type { MutableTestResult } from '@hanamaru/runner/domain/result/mutable'
import { formatNode } from './pretty.js'
import { diagnostic } from '../../../../../runner/src/domain/result/diagnostic.js'

test('property diagnostics identify generation and shrink inputs with replay information', () => {
  const node: MutableTestResult = {
    kind: 'test',
    name: 'contract',
    path: [],
    cases: [
      {
        caseKind: 'property',
        characteristic: 'pure',
        name: 'positive',
        origin: { file: 'sample.ts', line: 1, column: 1 },
        path: [0],
        row: null,
        config: { timeout: 1000, retry: 0 },
        durationMs: 1,
        attempts: [
          {
            attempt: 0,
            status: 'failed',
            durationMs: 1,
            outcome: null,
            assertions: [],
            cleanup: 'complete',
            failures: [0, 1].map(() => ({
              kind: 'outcome',
              phase: 'target',
              message: 'unexpected target outcome',
              expected: 'return',
              actual: { kind: 'throw', value: diagnostic('failure') },
            })),
            property: {
              classification: 'generated',
              source: diagnostic({ kind: 'integer', min: 0, max: 100 }),
              seed: 42,
              version: 1,
              runs: 100,
              maxShrinks: 10,
              originalCounterexample: diagnostic([61]),
              counterexample: diagnostic([51]),
              shrinkPath: [0],
              stopped: 'counterexample',
            },
            evaluations: [61, 51].map((input, i) => ({
              kind: i === 0 ? 'generated' : 'shrink',
              sampleIndex: i,
              input: diagnostic([input]),
              operations: [],
              expectedTermination: 'return',
              terminationTarget: null,
              status: 'failed',
              outcome: null,
              assertions: [],
              failureIndexes: [i],
              cleanup: 'complete',
            })),
          },
        ],
      },
    ],
  }
  const output = formatNode(node).join('\n')
  for (const expected of [
    'seed 42',
    'input range:',
    'min: 0',
    'max: 100',
    'original counterexample: [61]',
    'counterexample: [51]',
    'stopped: counterexample',
    'generated evaluation 1',
    'shrink evaluation 2',
    'input: [61]',
    'input: [51]',
  ])
    expect(output).toContain(expected)
  const current = node.cases[0].attempts[0]
  if (!current.property) throw new Error('property record is required')
  current.property = { ...current.property, classification: 'fixed', stopped: 'completed' }
  current.status = 'passed'
  current.failures = []
  expect(formatNode(node).join('\n')).toContain('property fixed')
})
