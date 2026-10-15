# In-source testing

実装と同じファイルにテスト定義を書けます。非公開の関数やmodule内の値もそのファイルのスコープから参照できます。
テストを実行する公開run系APIは呼ばず、registerTestで定義を登録します。

<!-- example: docs/examples/in-source.ts -->
```ts
import type {} from 'hanamaru'
import * as data from './data.ts'

const multiplier = 2
function privateCalc() { return data.getData() * multiplier }

if (import.meta.hanamaru) {
  const { Test, registerTest } = import.meta.hanamaru
  registerTest(new Test().mock(data, 'getData', m => m.returns(10)).target(privateCalc)
    .it('非公開の実装と依存を検証する', t => t.args().expect(e => [e.result.toBe(20)])))
}
```
出典: [docs/examples/in-source.ts](../examples/in-source.ts)

runnerが管理する読込環境ではimport.meta.hanamaruにTest・registerTest・middleware・resource・relationが提供されます。
通常のNode.jsでこのファイルをimportするとimport.meta.hanamaruは未定義で、登録ブロックは評価しません。
TypeScriptではhanamaruの型だけをimportするとImportMetaの型が使えます。

ファイルを明示してCLIから実行できます。既定探索に含める場合は設定のincludeSourceにglobを指定します。
includeSourceはproject未設定時の既定探索へ追加されます。projectを使う場合はそのprojectのincludeにsourceのパターンを指定します。

特定の一つを実行するときは[CLIの対象一覧・ID・宣言位置](../reference/cli.md#特定の対象を選ぶ)を使います。
ケースを絞っても、そのケースに必要な親middlewareとresourceは実行計画に含まれます。

本番のbundleから登録ブロックを除去したい場合は、bundlerのdefineでimport.meta.hanamaruをundefinedに置き換えます。
これは通常importでブロックが評価されないことに加え、テストコード自体を除去するための設定です。
