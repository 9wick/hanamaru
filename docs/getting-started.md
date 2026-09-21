# はじめる

このページは実装予定のAPIを使った入門例です。現在は型契約とサンプルを検証でき、ランナーは未実装です。

## 最初のテスト

対象の `math.ts`。

```ts
export function add(a: number, b: number): number {
  return a + b
}
```

同じディレクトリの `math.test.ts`。

```ts
import { Test } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add)
  .it('2つの数を足す', t => t.args(1, 2).expect(e => [
    e.result.toBe(3),
  ]))
```

1. `.target(add)` で対象を渡すと、引数と期待値の型が決まります。
2. `.it()` にケース名を書き、`.args()` に対象の引数を渡します。
3. `.expect()` で期待する条件の配列を返します。
4. 完成した定義をexportすると、CLIの実行対象になります。

`.args('1', 2)` や `e.result.toBe('3')` は型エラーです。
ケースの識別子や対象ファイルの情報を書く必要はありません。

## モックを使う

`user.ts`。依存の実装は、例を自己完結させるための小さなスタブです。

```ts
export interface User { id: string }
export interface CreateUserInput { name: string }

export const userRepository = {
  async save(_input: CreateUserInput): Promise<User> {
    return { id: 'u1' }
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

`user.test.ts`。

```ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export const users = new Test()
  .target(createUser)
  // 振る舞いを変えたい依存だけ、共通のモックを設定する。
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expect(e => [
      e.result.toEqual({ id: 'u1' }),
    ])
    .expectCalls(call => [
      call(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ])
  )
  .it('保存に失敗したら通知しない', t => t
    // このケースだけ、共通設定を上書きする。
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .args({ name: 'Alice' })
    .expect(e => [
      e.error.toBeInstanceOf(Error),
    ])
    .expectCalls(call => [
      call(mailService, 'send').notCalled(),
    ])
  )
```

saveの `.mock()` は全ケース共通です。2つ目のケースではrejectする振る舞いに置き換わります。
sendにはモックを設定していません。expectCallsに指定するだけで、本物のsendを呼びながら記録・検証します。
振る舞いも置き換えたい場合は `.mock(mailService, 'send', m => m.resolves(undefined))` を共通設定に追加できます。

`e.result` は正常終了、`e.error` はthrow / rejectを期待します。
同じ配列に両方を入れると型エラーです。expectCallsだけで呼び出しを検証する場合も、正常終了を期待します。

## モックもspyも登録せずに検証する

```ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

// モックを設定せず、本物の処理がどう呼ばれるかを検証する。
export const calls = new Test()
  .target(createUser)
  .it('保存して通知する', t => t
    .args({ name: 'Alice' })
    .expectCalls(call => [
      call(userRepository, 'save').calledOnceWith({ name: 'Alice' }),
      call(mailService, 'send').calledOnceWith({ id: 'u1' }),
    ]))
```

`call` はexpectCallsのコールバック引数です。追加の関数をimportする必要はありません。
コールバックが返す配列から、実行前にどのメソッドを記録するかを決められます。

## setupから値を渡す

```ts
import { Test } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add)
  .setup(() => ({ a: 1, b: 2, expected: 3 }))
  .it('準備した値を使う', t => t
    .argsFrom(ctx => [ctx.a, ctx.b])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

setupは各ケースの各試行で実行します。戻り値の型が `argsFrom` と `e.ctx` に伝わります。
非同期setupも使えます。準備と後始末を同じ場所に書く場合は、[useのmiddleware](./middleware.md)でケースを囲みます。
共通設定は最初のケース・groupの前に書き、追加した後の変更は型で防ぎます。

## 実行環境とコマンド

実装後の利用では、JavaScriptと型定義を含むhanamaruパッケージとTypeScriptを開発依存に追加します。
初版の対応目標はNode.js 22.18以上・TypeScript 5.8以上です。[制約](./limitations.md)も参照してください。

`package.json` の設定例。

```json
{
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "tsc --noEmit && hanamaru"
  }
}
```

`tsconfig.json` の設定例。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts"]
}
```

この例ではソースとテストを `src` 以下に置き、importに `.ts` 拡張子を付けます。
ランナー単独では型チェックしないため、通常のtest scriptで両方を実行します。
上記のインストール・CLI実行は、公開パッケージがまだないため未検証です。
リポジトリ内の例は `tsc -p docs/spec/tsconfig.json` で検証できます。

次は[テストをグループにまとめる](./grouping.md)と[実行計画とmetadata](./metadata.md)を参照してください。

## 入力を並べる・実行設定を変える

入力と期待だけが違うケースには[each](./each.md)を使えます。
[timeoutとretry](./execution-options.md)はgroup・target・ケースで設定し、必要な項目だけ上書きできます。
[失敗の表示と結果](./results.md)には宣言位置が自動で残り、IDやソース位置の入力は不要です。
