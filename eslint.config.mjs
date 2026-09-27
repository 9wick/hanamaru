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
    files: ['src/**/*.ts', 'vite.config.ts'],
    languageOptions: { parserOptions: { project: './tsconfig.json', tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
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
