# 複数実行を必要とする性質を検証する

propertyのstepsは宣言した対象だけを実行します。単一関数ならs.target、対象集合ならscenarioのキーを使います。可換性・冪等性・単調性・参照実装との一致を、閉じたlaw集合の追加を待たずに書けます。

## encodeとdecodeの往復を確かめる

<!-- example: none — 公開APIの記述契約：往復関係 -->
```ts
import { Test, scenario, strings, tuples, registerTest } from 'hanamaru'
const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
registerTest(new Test().target(scenario({ encode, decode }))
  .it('日本語の回帰例', t => t.steps(s => s.decode.args(s.encode.args('こんにちは')))
    .expect(e => [e.result.toEqual('こんにちは')]))
  .property('往復する', p => p.forAll(tuples(strings())).steps(s =>
    s.decode.args(s.encode.args(s.input[0])))
    .expect(e => [e.on({ actual: e.result, expected: e.sample(0) })
      .satisfies('元へ戻る', ({ actual, expected }) => actual === expected)])))
```

各操作は宣言順にawaitされ、正常結果を次の引数へ渡します。比較用の値は取得時点に保存します。途中の例外は失敗で、未実行の後続を報告します。

## 同じ関数の性質

同じ関数のpropertyで複数回呼ぶだけなら、targetを集合へ変える必要はありません。[冪等性と可換性の例](writing-tests.md#性質)のようにpropertyのstepsでs.targetを繰り返し使います。

## 具体例と性質を混同しない

単一関数のitにはstepsがありません。scenarioのitは宣言済み対象の具体的な操作列と期待値を検証でき、pure/effectfulで可否を変えません。どのitにもon/satisfiesは提供せず、入力範囲や実行結果間の性質はpropertyへ書きます。複数回であることだけを理由に性質と判定しません。

## 実行と検証の範囲

生成例・縮小候補ごとに環境を初期化します。一評価のstepsの間では必要な状態を共有します。effectfulな冪等性もpropertyのstepsで繰り返し実行し、受信側の観測やstate.afterで件数・状態を確かめます。[操作列](flow.md)に従います。
