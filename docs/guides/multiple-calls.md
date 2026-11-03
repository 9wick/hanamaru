# 複数実行を必要とする性質を検証する

冪等性や往復関係はpropertyで検証します。target(fn)に自由なcallsを提供せず、propertyの法則が必要な実行を管理します。具体例のitに入力生成や任意述語を混ぜません。

## encodeとdecodeの往復を確かめる

<!-- example: none — 公開APIの記述契約：関数間の性質 -->
```ts
import { Test, relation, strings, tuples, roundTrip, registerTest } from 'hanamaru'
const encode = (text: string) => new TextEncoder().encode(text)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
registerTest(new Test().target(relation({ encode, decode })).pure()
  .property('往復する', p => p.forAll(tuples(strings()))
    .law(roundTrip('encode', 'decode'))))
```

relationはpureな変換の集合です。法則は対象キーと単一引数の型を検査し、decode(encode(x))と最初の入力を比較します。最初の入力は実行前に保存し、最終結果の変更へ追従させません。法則を作るために別のテスト対象関数で包ませません。

## 同じ関数の冪等性

<!-- example: none — 公開APIの記述契約：冪等性 -->
```ts
import { Test, strings, tuples, idempotent, registerTest } from 'hanamaru'
const normalize = (text: string) => text.trim()
registerTest(new Test().target(normalize)
  .it('空白を除く', t => t.args(' hello ').expect(e => [e.result.toEqual('hello')]))
  .property('冪等', p => p.forAll(tuples(strings())).law(idempotent())))
```

idempotentはpureな単一引数関数で正常結果を再入力できる型に限ります。一評価内でf(x)とf(f(x))を順に実行し、取得した時点の保存値を比較します。

## 具体例と性質を混同しない

itは具体的な入力と期待結果、propertyは入力生成と成立する性質を持ちます。lawはproperty専用で、expect/argsFrom/stepsと併用しません。異なる入力を手書きで呼んで比較する汎用callsを、具体例に開放しません。

## 実行と検証の範囲

一つの法則の内部では実行結果を次へ渡しますが、生成例や縮小候補の間は評価を分離します。lawは全呼び出しの正常完了を期待し、途中の例外と未実行の後続を報告します。反例の生成・縮小・再現は[公開構文](writing-tests.md#入力の生成と縮小と再現)に従います。

状態を持つ操作間の性質は、effectfulなscenarioのpropertyへ操作列を書きます。[操作列](flow.md)を参照してください。
