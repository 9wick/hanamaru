import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../src')
const allowed = {
  interfaces: new Set(['interfaces', 'application', 'domain', 'foundation']),
  application: new Set(['application', 'domain', 'foundation']),
  domain: new Set(['domain', 'foundation']),
  infrastructure: new Set(['infrastructure', 'application', 'domain', 'foundation']),
  foundation: new Set(['foundation']),
}

export const architecturePlugin = {
  rules: {
    dependencies: {
      meta: {
        type: 'problem',
        schema: [],
        messages: {
          layer: '{{from}} から {{to}} への依存は禁止です。責務を移すか application の契約を介してください。',
          external: '{{layer}} に実行環境への依存 {{source}} を持ち込めません。infrastructure で実装してください。',
        },
      },
      create(context) {
        const filename = context.filename
        const from = relative(sourceRoot, filename).split(sep)[0]
        if (!Object.hasOwn(allowed, from)) return {}
        function check(node) {
          const source = node.source
          if (source?.type !== 'Literal' || typeof source.value !== 'string') return
          const specifier = source.value
          if (specifier.startsWith('.') || isAbsolute(specifier)) {
            const destination = relative(sourceRoot, resolve(dirname(filename), specifier))
            const to = destination.split(sep)[0]
            if (!allowed[from].has(to)) context.report({ node: source, messageId: 'layer', data: { from, to } })
          } else if (['application', 'domain', 'foundation'].includes(from)) {
            // 公開設定の Vite 型は互換性の契約。実装の import は許可しない。
            const publicConfigType =
              filename === resolve(sourceRoot, 'application/collection/config.ts') &&
              node.type === 'TSImportType' &&
              specifier === '@hanamaru/vite'
            if (specifier !== 'valibot' && !publicConfigType)
              context.report({ node: source, messageId: 'external', data: { layer: from, source: specifier } })
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
