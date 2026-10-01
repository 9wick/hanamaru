import { readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { expect, test } from 'vite-plus/test'
import { cases, fixture, invoke, jsonResult, repository, workspace, workspaceRuntime } from './harness.ts'

const runtime = `import { Test, registerTest, middleware } from ${JSON.stringify(workspaceRuntime)}\n`
const caseOf = (name: string) =>
  `new Test().target(() => 1).it('${name}', t => t.args().expect(e => [e.result.toBe(1)]))`

/** fixtureは生成文字列なので行番号が決まる。列はチェーンのメソッド名の1始まりの位置になる。 */
function locate(file: string, method: string, find: (line: string) => boolean) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const index = lines.findIndex(find)
  expect(index, `${method} not found in ${file}`).toBeGreaterThan(-1)
  return { file, line: index + 1, column: lines[index].indexOf(method) + 2 }
}

function unregisteredWarning(file: string, method: string, find: (line: string) => boolean): string {
  const at = locate(file, method, find)
  return `hanamaru: unregistered test definition: ${relative(repository, file)}:${at.line}:${at.column}`
}

test('CLI executes registrations without exports and rejects export-only files', () => {
  const data = fixture(`registerTest(${caseOf('registered')})`)
  const output = jsonResult(invoke(workspace, data.file, '-r', 'json'), 0)
  expect(output.tests[0].kind).toBe('test')
  const exported = join(data.dir, 'exported.test.mjs')
  writeFileSync(exported, `${runtime}export const orphan = ${caseOf('orphan')}\n`)
  const result = invoke(workspace, exported, '-r', 'json')
  expect(result.status, result.stderr).toBe(2)
  expect(result.stderr).toContain('no tests registered')
  expect(result.stdout).toBe('')
})

test('registrations in imported files run only when those files are selected', () => {
  const data = fixture(`import './helper.mjs'\nregisterTest(${caseOf('entry')})`)
  const helper = join(data.dir, 'helper.mjs')
  writeFileSync(helper, `${runtime}registerTest(${caseOf('helper')})\n`)
  expect(jsonResult(invoke(workspace, data.file, '-r', 'json'), 0).tests).toHaveLength(1)
  expect(jsonResult(invoke(workspace, data.file, helper, '-r', 'json'), 0).tests).toHaveLength(2)
})

test('project includes and excludes files, merges overlaps, and reports every membership', () => {
  const data = fixture(`registerTest(${caseOf('unit')})`)
  const shared = join(data.dir, 'shared.test.mjs')
  const e2e = join(data.dir, 'e2e.test.mjs')
  writeFileSync(shared, `${runtime}registerTest(${caseOf('shared')})\n`)
  writeFileSync(
    e2e,
    `${runtime}console.error('E2E_IMPORTED')\nregisterTest(new Test().group(middleware(async (_, next) => { console.error('E2E_STARTED'); return next() }), [${caseOf('e2e')}]))\n`,
  )
  const config = join(data.dir, 'hanamaru.config.mjs')
  writeFileSync(
    config,
    `export default { projects: {
    unit: { include: [${JSON.stringify(join(data.dir, '*.test.mjs'))}], exclude: [${JSON.stringify(e2e)}] },
    e2e: { include: [${JSON.stringify(e2e)}, ${JSON.stringify(shared)}] }
  } }`,
  )
  const selected = invoke(workspace, '--config', config, '--project', 'unit', '-r', 'json')
  const unit = jsonResult(selected, 0)
  expect(unit.tests).toHaveLength(2)
  expect(selected.stderr).not.toContain('E2E_STARTED')
  expect(selected.stderr).not.toContain('E2E_IMPORTED')
  expect(unit.tests.map((node) => node.source?.projects)).toStrictEqual([['unit'], ['unit']])

  const merged = jsonResult(
    invoke(workspace, '--config', config, '--project', 'unit', '--project', 'e2e', '-r', 'json'),
    0,
  )
  expect(merged.tests).toHaveLength(3)
  expect(merged.tests.find((node) => node.source?.file.endsWith('shared.test.mjs'))?.source?.projects).toStrictEqual([
    'unit',
    'e2e',
  ])
  expect(jsonResult(invoke(workspace, '--config', config, '-r', 'json'), 0).tests).toHaveLength(3)
  const explicit = invoke(workspace, data.file, '--project', 'unit', '--config', config)
  expect(explicit.status).toBe(2)
  expect(explicit.stderr).toContain('--project cannot be combined with files')
})

test('CLI warns for a standalone unregistered definition, but not its chained values or group children', () => {
  const data = fixture(`
const child = ${caseOf('child')}
const root = new Test().group([child])
const orphan = ${caseOf('orphan')}
registerTest(root)
`)
  const result = invoke(workspace, data.file, '-r', 'json')
  expect(result.status, result.stderr).toBe(0)
  expect(result.stderr.match(/unregistered test definition/g)).toHaveLength(1)
  // 警告されるのがorphan自身であることを位置で確かめる。childとチェーンの途中値は警告されない。
  expect(result.stderr).toContain(unregisteredWarning(data.file, '.it(', (line) => line.startsWith('const orphan =')))
  expect(jsonResult(result, 0).tests).toHaveLength(1)
})

test('only and --ci apply to the merged selection before and after filtering respectively', () => {
  const data = fixture(
    `registerTest(new Test().target(() => 1).only('exclusive', t => t.args().expect(e => [e.result.toBe(1)])))`,
  )
  const ordinary = join(data.dir, 'ordinary.test.mjs')
  writeFileSync(ordinary, `${runtime}registerTest(${caseOf('ordinary')})\n`)
  const config = join(data.dir, 'hanamaru.config.mjs')
  writeFileSync(
    config,
    `export default { projects: {
    first: { include: [${JSON.stringify(data.file)}] },
    second: { include: [${JSON.stringify(ordinary)}] }
  } }`,
  )
  const selected = jsonResult(
    invoke(
      workspace,
      '--config',
      config,
      '--project',
      'first',
      '--project',
      'second',
      '--filter',
      'ordinary',
      '-r',
      'json',
    ),
    0,
  )
  expect(selected.tests).toHaveLength(1)
  const ci = invoke(
    workspace,
    '--config',
    config,
    '--project',
    'first',
    '--project',
    'second',
    '--filter',
    'ordinary',
    '--ci',
  )
  expect(ci.status).toBe(2)
  expect(ci.stderr).toContain('only is forbidden')
})

test('invalid project configuration and unknown project are collection errors', () => {
  const data = fixture(`registerTest(${caseOf('valid')})`)
  const config = join(data.dir, 'hanamaru.config.mjs')
  writeFileSync(config, `export default { projects: { unit: ${JSON.stringify(data.file)} } }`)
  const invalid = invoke(workspace, '--config', config, '--project', 'unit')
  expect(invalid.status).toBe(2)
  writeFileSync(config, `export default { include: [${JSON.stringify(data.file)}] }`)
  const topLevel = invoke(workspace, '--config', config)
  expect(topLevel.status).toBe(2)
  expect(topLevel.stderr).toContain('include and exclude must be configured in projects')
  writeFileSync(config, `export default { projects: { unit: { include: [${JSON.stringify(data.file)}] } } }`)
  const unknown = invoke(workspace, '--config', config, '--project', 'missing')
  expect(unknown.status).toBe(2)
  expect(unknown.stderr).toContain('unknown project: missing')
})

test('the unregistered warning points at the chain call that completed the definition', () => {
  const data = fixture(`
const multiline = new Test()
  .target(() => 1)
  .it('multiline', t => t.args().expect(e => [e.result.toBe(1)]))

const rows = new Test()
  .target(n => n)
  .each('row', [1, 2], (t, row) => t.args(row).expect(e => [e.result.toBe(row)]))

registerTest(${caseOf('registered')})
`)
  const result = invoke(workspace, data.file, '-r', 'json')
  expect(result.status, result.stderr).toBe(0)
  // eachは行ごとに定義を作るが、警告は未使用の最後の1件だけで、位置はどの行も同じ.each(の呼び出し位置になる。
  expect(result.stderr.split('\n').filter((line) => line.includes('unregistered test definition'))).toEqual([
    unregisteredWarning(data.file, '.it(', (line) => line.includes(".it('multiline'")),
    unregisteredWarning(data.file, '.each(', (line) => line.includes('.each(')),
  ])
  expect(jsonResult(result, 0).tests).toHaveLength(1)
})

test('registrations in one file keep their order and their origins', () => {
  const data = fixture(['first', 'second', 'third'].map((name) => `registerTest(${caseOf(name)})`).join('\n'))
  const output = jsonResult(invoke(workspace, data.file, '-r', 'json'), 0)
  expect(
    output.tests.map((node) => {
      const [first] = cases(node)
      return { name: first.name, ...first.origin }
    }),
  ).toEqual(
    ['first', 'second', 'third'].map((name) => ({
      name,
      ...locate(data.file, '.it(', (line) => line.includes(`.it('${name}'`)),
    })),
  )
})

test('registering the same definition twice reports the second registration', () => {
  const data = fixture(`const shared = ${caseOf('shared')}\nregisterTest(shared)\nregisterTest(shared)\n`)
  const result = invoke(workspace, data.file, '-r', 'json')
  expect(result.status).toBe(2)
  const lines = readFileSync(data.file, 'utf8').split('\n')
  const duplicate = lines.lastIndexOf('registerTest(shared)') + 1
  expect(result.stderr).toContain(`duplicate root definition: ${relative(repository, data.file)}:${duplicate}`)
})
