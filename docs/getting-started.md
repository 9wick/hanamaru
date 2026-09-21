# はじめる

最初に、純粋関数のテストで「定義する・計画を得る・実行する」をたどる。
このページは実装するAPIの使用例。現在のリポジトリでは型契約の検証まで可能で、hanamaru自体の実行はまだできない。

## プロジェクトの設定

配布後のインストール手順は次のとおり。

```console
npm install --save-dev hanamaru typescript
```

Node.js 22.18以上、TypeScript 5.8以上を対応目標とする。既存の `package.json` に次を追加する。

```json
{
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "tsc --noEmit && hanamaru"
  }
}
```

`tsconfig.json` の最小例。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true
  },
  "include": ["src/**/*.ts"]
}
```

相対importは `.ts` まで書き、型のimportには `import type` を使う。
ここではNodeが直接解決できる書き方を使う。ランタイム・構文の条件は[制約](./limitations.md)を参照。

## 対象を書く

`src/math.ts`。省略した実装はない。

```ts
export function add(a: number, b: number): number {
  return a + b
}
```

## テストを書く

`src/math.test.ts`。

```ts
import { Test } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add, { source: { file: 'src/math.ts', exportName: 'add' } })
  .it('2つの数を足す', t => t.args(1, 2).expect(e => [
    e.result.toBe(3),
  ]), { id: 'adds-two-numbers' })
```

- `.target(add)` で対象を固定する。`source` は任意の宣言元情報で、省略しても実行できる。
- `.args(1, 2)` は `add` の引数に対応する。
- `.expect()` は正常終了を要求し、配列に書いた条件をすべて検証する。
- 第3引数の `id` は任意。省略時はケース名をそのままケースIDにする。
- exportされた完成済みのテストをCLIが実行する。

`.args('1', 2)` や `e.result.toBe('3')` は型エラーになる。
型チェックと実行をまとめて行う通常の入口は `npm test` とする。

## 実行前の計画を見る

```ts
const plan = addition.plan()

plan.target               // 対象の種類と関数への参照
plan.cases[0]             // 入力・モック・期待を持つケース
```

`.plan()` はtargetもsetupも呼ばない。テストの構造をそのまま取得する。
詳しくは[実行計画とmetadata](./metadata.md)を参照。

## 実行する

```console
npm test
```

期待する表示例。

```text
add
  ✓ 2つの数を足す
```

ライブラリとして実行する場合は、計画を明示的に渡す。

```ts
import { run } from 'hanamaru'
import { addition } from './math.test.ts'

const result = await run(addition.plan())
```

期待値を `4` にするとテストは失敗する。表示では期待値4と実際の値3を区別する。
型チェックの失敗は実行前に、値の不一致は実行時に検出される。

## モックと例外期待を書く

`src/user.ts`。外部サービスの代わりに、小さな実装を持つ例を使う。

```ts
export interface User { id: string; name: string }
export interface CreateUserInput { name: string }

export const userRepository = {
  async save(input: CreateUserInput): Promise<User> {
    return { id: 'u1', name: input.name }
  },
}
export const mailService = {
  async send(_user: User): Promise<void> {},
}
export async function createUser(input: CreateUserInput): Promise<User> {
  const user = await userRepository.save(input)
  await mailService.send(user)
  return user
}
```

`src/user.test.ts`。

```ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export const users = new Test()
  .target(createUser, { source: { file: 'src/user.ts', exportName: 'createUser' } })
  .mock('save', userRepository, 'save', m => m.resolves({ id: 'u1', name: 'Alice' }))
  .mock('send', mailService, 'send', m => m.resolves(undefined))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toEqual({ id: 'u1', name: 'Alice' }),
      e.mock('save').calledOnceWith({ name: 'Alice' }),
      e.mock('send').calledOnceWith({ id: 'u1', name: 'Alice' }),
    ]), { id: 'save-and-notify' })
  .it('保存に失敗したら通知しない', t => t
    .override('save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expectError(e => [
      e.error.toThrow('save failed'),
      e.mock('send').notCalled(),
    ]), { id: 'save-failure' })
```

`expectError` はtargetの例外送出・Promiseのrejectを要求する。
setupなど準備段階の失敗は、期待したtargetの例外とは扱わない。
正常系の `expect` では `e.result`、例外系では `e.error` だけが使える。

[ケースビルダー](./api-it.md)、[再利用](./reuse.md)へ進むと、コンテキストと依存の組み立て方が分かる。

## このリポジトリで確認できる範囲

掲載例の実ファイルは [examples](./examples/math.test.ts) にある。
公開APIの型契約を参照して、次のコマンドでコンパイルできる。

```console
tsc -p docs/spec/tsconfig.json
```

これはAPIの型と例の整合性を検証する。ランナーの実行結果を検証するものではない。
