# 複数の呼び出しで契約をテストする

関数間の関係や、一つの関数を異なる引数で呼んだ結果を、一つのケースで検証します。対象はtargetへ固定し、callsでその対象への入力と結果の受け渡しを記述します。

## encodeとdecodeの往復を確かめる

関係を対象にする場合は、名前付きの関数群をrelationへ渡します。対象外の関数をケースから追加することはできません。

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

encodedは実行前の呼び出し記述です。実行器がencodeの完了を待ち、その結果をdecodeへ渡します。ここで確かめるのは、指定した入力で往復すると元の値へ戻ることです。

## 同じ関数を二種類の引数で呼ぶ

同じ関数の結果間の関係を確かめる場合は、targetを増やしません。

```text
対象: relationKey
一つ目の入力: ab, c
二つ目の入力: a, bc
期待する関係: 二つの結果が異なる
```

結果を名前付きで参照し、`.relate(r => [r.different(r.result.field('first'), r.result.field('second'))])` と書きます。[コード例と禁止例](writing-tests.md#関係)に従います。単独の具体値の期待を汎用notで弱める書き方とは区別します。この二例の結果が異なることを、全入力で衝突しない保証にはしません。

## 一回の呼び出しは従来どおり書く

一つの具体的な期待結果を確かめる場合は、対象へ引数と期待値を直接指定します。

<!-- example: docs/examples/multiple-calls.test.ts#single -->
```ts
.target(relationKey)
.it('二つの値からキーを作る', t => t
  .args('ab', 'c')
  .expect(e => [e.result.toBe('["ab","c"]')]))
```

## callsは操作を実行せず、呼び出しを記述する

args / argsFromとcallsは択一です。呼び出し記述は型付きの結果参照であり、定義時の実測値として計算・分岐できません。結果参照を別の呼び出しの入力へ渡すと、実行器が依存順に実行します。

同じ呼び出し記述は一試行に一度実行します。同じ引数でも別々に記述した呼び出しは別の実行です。検証する結果に結び付かない記述を、副作用を起こすためだけに並べることはできません。

## targetから書ける呼び出しを絞る

- 呼べるのは宣言したtargetまたはrelationの構成要素だけです。
- 引数と結果参照の型は対象から推論します。型や保存用IDを重ねて書きません。
- 空の結果、引数との型不整合、別ケースの参照、循環を拒否します。
- 比較は実際に得られた入力・結果の参照を使い、具体値・性質・関係の用途を区別します。

型で表せる不正は定義時に拒否し、動的な不正は実行受付で検査します。

## 実行と検証の範囲

一つのケース・試行として実行します。他のケースの結果や順序には依存できません。値の依存がない呼び出し同士の順序は保証せず、状態を変える操作の順序は[flow](flow.md)で明示します。

必要な結果が得られなければ、依存する後続の実行・検証を成功にしません。失敗した対象・入力・原因と、実行済み・未実行・未評価を区別します。期待する失敗もtargetの契約に従い、正常結果を必要とする関係に失敗を混入させません。

callsはpure単一・relationに限り、副作用を伴う操作はscenarioのstepsへ書きます。effect/scenarioでは状態/actionの観測と許可済み境界の呼び出し条件を組み合わせられます。
