import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packages = {
  blueprint: new Set(['blueprint']),
  'module-runtime': new Set(['module-runtime']),
  execution: new Set(['execution', 'blueprint', 'module-runtime']),
  cli: new Set(['cli', 'execution', 'blueprint', 'module-runtime']),
}
const layers = {
  interfaces: new Set(['interfaces', 'application', 'domain', 'foundation']),
  application: new Set(['application', 'domain', 'foundation']),
  domain: new Set(['domain', 'foundation']),
  infrastructure: new Set(['infrastructure', 'application', 'domain', 'foundation']),
  foundation: new Set(['foundation']),
}
const manifests = Object.fromEntries(
  Object.keys(packages).map((name) => [
    name,
    JSON.parse(readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8')),
  ]),
)

function location(filename) {
  const parts = relative(root, filename).split(sep)
  if (parts[0] === 'packages' && Object.hasOwn(packages, parts[1]) && parts[2] === 'src')
    return { package: parts[1], layer: parts[3] }
  if (parts[0] === 'src') return { package: 'distribution', layer: 'entry' }
  if (parts[0] === 'e2e') return { package: 'e2e', layer: parts[1] }
  return null
}

export const architecturePlugin = {
  rules: {
    dependencies: {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          package: '{{from}} から {{to}} への依存は禁止です。所有する責務の契約を介してください。',
          private: '別パッケージのsourceへ直接依存できません。所有パッケージのexportsを使ってください。',
          export: '{{source}} は所有パッケージが公開していない入口です。',
          declared: '{{source}} はこのパッケージのdependenciesに宣言されていません。',
          layer: '{{from}} から {{to}} への依存は禁止です。責務を移すか application の契約を介してください。',
          external: '{{layer}} に実行環境への依存 {{source}} を持ち込めません。infrastructure で実装してください。',
          e2e: 'E2EはCLIを起動して公開出力を検証します。内部実装やテスト本体からのSDK実行に依存できません。',
        },
      },
      create(context) {
        const from = location(context.filename)
        if (!from) return {}
        function check(node) {
          const source = node.source
          if (source?.type !== 'Literal' || typeof source.value !== 'string') return
          const specifier = source.value
          if (from.package === 'e2e') {
            const target =
              specifier.startsWith('.') || isAbsolute(specifier)
                ? location(resolve(dirname(context.filename), specifier))
                : null
            const privatePackage = /^@hanamaru\/(blueprint|definition|execution|module-runtime|cli)(\/|$)/.test(
              specifier,
            )
            const typeOnly =
              node.type === 'TSImportType' ||
              node.importKind === 'type' ||
              node.exportKind === 'type' ||
              (node.type === 'ImportDeclaration' &&
                node.specifiers.length > 0 &&
                node.specifiers.every((item) => item.importKind === 'type'))
            if (
              privatePackage ||
              ((specifier.startsWith('.') || isAbsolute(specifier)) && target?.package !== 'e2e') ||
              (specifier === 'hanamaru' && !typeOnly && from.layer !== 'fixtures')
            )
              context.report({ node: source, messageId: 'e2e' })
            return
          }
          if (specifier.startsWith('.') || isAbsolute(specifier)) {
            const to = location(resolve(dirname(context.filename), specifier))
            if (!to || to.package !== from.package) {
              context.report({ node: source, messageId: 'private' })
            } else if (layers[from.layer] && !layers[from.layer].has(to.layer)) {
              context.report({ node: source, messageId: 'layer', data: { from: from.layer, to: to.layer } })
            }
            return
          }
          const match = specifier.match(/^@hanamaru\/(blueprint|execution|module-runtime|cli)(?:\/(.*))?$/)
          if (match) {
            const [, to, subpath] = match
            if (from.package !== 'distribution' && !packages[from.package].has(to))
              context.report({ node: source, messageId: 'package', data: { from: from.package, to } })
            if (
              from.package !== 'distribution' &&
              from.package !== to &&
              !Object.hasOwn(manifests[from.package].dependencies, `@hanamaru/${to}`)
            )
              context.report({ node: source, messageId: 'declared', data: { source: specifier } })
            const target = manifests[to].exports[subpath === undefined ? '.' : `./${subpath}`]
            if (typeof target === 'string') {
              const targetLayer = target.split('/')[2] === 'index.ts' ? 'interfaces' : target.split('/')[2]
              if (layers[from.layer] && !layers[from.layer].has(targetLayer))
                context.report({ node: source, messageId: 'layer', data: { from: from.layer, to: targetLayer } })
            }
            if (!Object.hasOwn(manifests[to].exports, subpath === undefined ? '.' : `./${subpath}`))
              context.report({ node: source, messageId: 'export', data: { source: specifier } })
            return
          }
          if (specifier === 'hanamaru' && from.package !== 'distribution')
            context.report({ node: source, messageId: 'package', data: { from: from.package, to: 'distribution' } })
          if (from.package === 'blueprint' && from.layer !== 'infrastructure' && specifier.startsWith('node:'))
            context.report({ node: source, messageId: 'external', data: { layer: from.layer, source: specifier } })
          if (['application', 'domain', 'foundation'].includes(from.layer)) {
            const publicConfigType =
              from.package === 'cli' &&
              context.filename === resolve(root, 'packages/cli/src/application/collection/config.ts') &&
              node.type === 'TSImportType' &&
              specifier === '@hanamaru/vite'
            const injectionToken = from.layer === 'application' && specifier === '@zeltjs/core'
            if (specifier !== 'valibot' && !publicConfigType && !injectionToken)
              context.report({ node: source, messageId: 'external', data: { layer: from.layer, source: specifier } })
          }
        }
        return {
          ImportDeclaration: check,
          ExportNamedDeclaration: check,
          ExportAllDeclaration: check,
          ImportExpression: check,
          TSImportType: check,
        }
      },
    },
  },
}
