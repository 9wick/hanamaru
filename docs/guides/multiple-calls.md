# 複数の呼び出しで契約をテストする

関数間の関係や、一つの関数を異なる引数で呼んだ結果を、一つのケースで検証できます。
検証対象はtargetで宣言し、`.calls()`でその対象への呼び出しと引数を書き、`.expect()`で結果を確かめます。

通常の一回の呼び出しについては[itビルダー](../reference/api-it.md)を参照してください。

## encodeとdecodeの往復を確かめる

二つの関数の間に成立する関係を対象にする場合は、`relation({ encode, decode })`をtargetへ渡します。

<!-- example: docs/examples/multiple-calls.test.ts#codec -->
```ts
import { Test, registerTest, relation } from 'hanamaru'

const encode = (value: string) => new TextEncoder().encode(value)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
const input = 'こんにちは'

const codec = new Test()
  .target('codecの往復関係', relation({ encode, decode }))
  .it('元の値に戻る', t => t
    .calls(c => {
      const encoded = c.encode.args(input)
      return c.decode.args(encoded)
    })
    .expect(e => [e.result.toBe(input)]))

registerTest(codec)
```
出典: [docs/examples/multiple-calls.test.ts](../examples/multiple-calls.test.ts)

`c.encode`と`c.decode`は、宣言した対象への呼び出しを記述するためのビルダーです。
`.args()`の引数型は、それぞれの関数から決まります。
`c.decode.args(encoded)`には、実行時にencodeが返した`Uint8Array`を渡します。
このケースの`e.result`は、最後に返した呼び出しの正常な戻り値、ここではdecodeが返したstringへのマッチャです。

関係の構成と、検証する具体的な性質は分けて書きます。
`relation`を宣言しただけでは呼び出し順や検証内容は決まりません。encodeとdecodeを並べても、往復関係を自動で検証することはありません。
このケースが確かめるのは、指定した入力について`decode(encode(input))`が元の値と一致することです。

## 同じ関数を二種類の引数で呼ぶ

同じ関数の性質を確かめる場合は、その関数一つをtargetにします。

<!-- example: docs/examples/multiple-calls.test.ts#keys -->
```ts
const relationKey = (from: string, to: string) => JSON.stringify([from, to])

const keys = new Test()
  .target(relationKey)
  .it('異なる組み合わせを区別する', t => t
    .calls(c => ({
      first: c.args('ab', 'c'),
      second: c.args('a', 'bc'),
    }))
    .expect(e => [
      e.result.toSatisfy(({ first, second }) => first !== second),
    ]))

registerTest(keys)
```
出典: [docs/examples/multiple-calls.test.ts](../examples/multiple-calls.test.ts)

targetが一つの関数なら、`c.args()`でその関数への呼び出しを記述します。
戻り値を名前付きのレコードで返すと、実行後の結果も同じ形になります。
この例の`e.result`は、`{ first: string; second: string }`へのマッチャです。
`e.result.first`をマッチャの入口にするのではなく、既存の`toSatisfy`等で結果全体を検証します。

`first`と`second`は検証する結果の名前です。操作ごとのstep名や、別途保存するための`.saveAs()`は不要です。
複数の引数で呼んでも、検証対象はrelationKey一つのままです。
このケースの非衝突性は指定した二組についての検証で、全入力についての保証ではありません。

## 一回の呼び出しは従来どおり書く

一回の対象呼び出しを検証するケースには、従来の`t.args()`を使えます。

<!-- example: docs/examples/multiple-calls.test.ts#single -->
```ts
.target(relationKey)
.it('二つの値からキーを作る', t => t
  .args('ab', 'c')
  .expect(e => [e.result.toBe('["ab","c"]')]))
```
出典: [docs/examples/multiple-calls.test.ts](../examples/multiple-calls.test.ts)

`.args()` / `.argsFrom()`と`.calls()`は二者択一です。一つのケースで両方を指定できません。
関係をtargetにしたケースには、呼び出す関数と引数を`.calls()`で明示します。
relation全体の共通引数を`t.args()`から推測したり、全構成要素へ同じ引数を配ったりはしません。

## callsは操作を実行せず、呼び出しを記述する

`.calls()`のコールバックは定義時に同期的に一度評価します。
`c.encode.args(input)`等は操作を実行せず、引数を持つ呼び出し記述を返します。
呼び出し記述は、その正常な戻り値への型付き参照として、別の呼び出しの引数へ渡せます。

`encoded`は、定義時には実際の`Uint8Array`ではありません。
参照に対する通常の計算、メソッド呼び出し、実行時の値に応じた分岐には使えません。
検証用の比較・加工には、`.expect()`内の実際の結果を使います。
結果参照は引数そのものとして渡します。結果の加工やプロパティ参照の記法は提供していません。

コールバックからは、検証する一つの呼び出し記述、または空でない名前付きの呼び出し記述のレコードを返します。
返した呼び出しと、その引数が参照する先行呼び出しを実行対象とします。
返した結果に結び付かない呼び出し記述は実行しません。副作用を起こす目的で、使わない呼び出しを並べる書き方には使いません。

同じ呼び出し記述への参照は、一試行で一つの結果を共有します。
同じ引数でも`.args()`を別々に書けば別の呼び出しです。引数の一致から呼び出しを自動でまとめません。
retryでは、同じ定義から新しい試行の結果を作り直します。

## targetから書ける呼び出しを絞る

`.calls()`に渡す`c`は、targetに宣言した対象に限って提供します。
relationでは構成要素のキー、一つの関数ではその関数に対応する引数ビルダーを使います。
任意の関数を渡せる`.call(fn)`は追加しません。

通常の型付きの利用では、次の書き間違いを型エラーにします。

- 宣言していない対象のキーを参照する。
- 対象の引数の個数や型が合わない。
- 正常な戻り値の型が合わない呼び出し参照を引数へ渡す。
- 呼び出し記述を返さない、asyncコールバックを渡す、または空の結果レコードを返す。
- `.args()` / `.argsFrom()`と`.calls()`を混在させる。

関数への引数は`Parameters`、正常な戻り値は`Awaited<ReturnType>`に基づきます。
別ケースに属する呼び出し記述の持ち込みや循環参照も禁止し、実行受付時に検査します。
TypeScriptの型検査を回避した場合も、不正な記述を未実行や成功扱いには置き換えません。

## 実行と検証の範囲

複数の呼び出しを含めても、一つの`.it()`は一つの独立したケースです。
他のケースの結果や実行順へ依存できません。
各試行ではmiddlewareの前処理後に呼び出しを実行し、すべての必要な正常結果を得てからexpectを評価します。
非同期の対象もawaitし、依存する呼び出しには解決後の値を渡します。

encodeの結果をdecodeの引数にした場合は、encodeの完了後にdecodeを呼びます。
値の依存がない呼び出し同士の順序は保証しません。状態を変える操作の順序自体を検証したい場合は、[シナリオを扱うflow](flow.md)として別に検討します。

通常の引数や戻り値を深く複製する保証はありません。共有したオブジェクトを対象が変更する場合は、その変更を踏まえてケースを設計します。
予期しないthrow / rejectや値解決の失敗はケースの失敗とし、成功に必要な結果が得られなければexpectを評価しません。
最初のthrow / rejectで呼び出しの実行を止めます。独立した後続呼び出しも実行しません。
診断には、失敗した呼び出しの対象と番号、未実行の呼び出し、元の例外を残します。
複数呼び出しのexpectには`e.error`を提供しません。例外そのものの検証には通常の`.args()` / `.argsFrom()`を使います。

middleware、timeout、retryは一試行全体へ適用します。
retryは呼び出し単位の再開にせず、復元・後始末が成功した場合にケース全体を最初から行います。
timeout・割り込み・復元や後始末の失敗では再試行しません。
既存の[実行設定](execution-options.md)と[middleware](middleware.md)の契約に従い、外部状態の初期化は利用者が行います。

このガイドは正常な戻り値を使った契約の検証を扱います。
一つのメソッドをtargetにした場合も`c.args()`を使い、`this`は従来どおり対象オブジェクトへ束縛します。
mock / expectCallsはケース全体へ適用でき、各呼び出しの観測を合算します。設定の記述位置と対象メソッド自身をmockできない制約は、従来の契約に従います。
relationの構成要素は関数です。`this`の束縛が必要なメソッドは、利用者が明示的に束縛した関数を渡します。
middlewareの値から引数を作る記法、結果の加工、複数呼び出しの例外の期待は今後の検討項目です。
設計上の採否は[判断記録](../concepts/design-review.md#関係と複数呼び出しのユーザー契約案)を参照してください。
