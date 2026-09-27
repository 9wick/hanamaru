import parser from '@typescript-eslint/parser'
import typescript from '@typescript-eslint/eslint-plugin'

export const typeSafetyRules = {
  'no-restricted-syntax': [
    'error',
    { selector: 'TSUnknownKeyword', message: 'unknownは禁止です。値の種類と入力契約を明示してください。' },
    {
      selector: 'TSAsExpression:not([typeAnnotation.typeName.name="const"])',
      message: 'asによる型アサーションは禁止です（as constは許可）。型注釈と実行時検証を使用してください。',
    },
    { selector: 'TSTypeAssertion', message: '型アサーションは禁止です。入力を検証してください。' },
    { selector: 'TSTypePredicate', message: '手書きの型述語は禁止です。検証ライブラリを使用してください。' },
  ],
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-non-null-assertion': 'error',
  '@typescript-eslint/no-unsafe-function-type': 'error',
  '@typescript-eslint/ban-ts-comment': [
    'error',
    {
      'ts-ignore': true,
      'ts-nocheck': true,
      'ts-check': false,
      'ts-expect-error': true,
    },
  ],
}
const typeAwareRules = {
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
  '@typescript-eslint/no-unsafe-argument': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
}
export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },
  { linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' } },
  {
    files: ['**/*.ts', '**/*.mts', '**/*.cts'],
    languageOptions: { parser },
    plugins: { '@typescript-eslint': typescript },
    rules: typeSafetyRules,
  },
  {
    files: ['src/**/*.ts', 'vite.config.ts', 'eslint.config.test.ts'],
    languageOptions: { parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } },
    rules: typeAwareRules,
  },
  {
    // e2eはe2e/tsconfig.jsonで型検査する。library.tsはインストール済みパッケージを実行時に叩く契約スクリプトで、
    // 型の絞り込みを持たないためそのプロジェクトから外してある。
    files: ['e2e/**/*.ts'],
    ignores: ['e2e/fixtures/library.ts'],
    languageOptions: { parserOptions: { project: './e2e/tsconfig.json', tsconfigRootDir: import.meta.dirname } },
    rules: typeAwareRules,
  },
  {
    files: ['docs/spec/*.ts'],
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
          'ts-expect-error': 'allow-with-description',
        },
      ],
    },
  },
]
