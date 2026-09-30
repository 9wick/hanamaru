# マッチャ

`.expect(e => [...])` に戻り値・例外の条件を、`.expectCalls(call => [...])` に呼び出しの条件を並べます。
`e.result`、`e.error`、`call(obj, key)` は記述子を作る入口で、`e.ctx` はそのケースのmiddlewareが渡した値を順に反映したコンテキストです。

## result

resultの期待値は、対象の `Awaited<ReturnType<F>>` から型推論します。
同期・非同期で書き方を変える必要はありません。

| マッチャ | 意味 |
|---|---|
| `toBe(value)` | Object.isで一致 |
| `toEqual(value)` | 深い一致 |
| `toMatchObject(partial)` | 指定したプロパティが部分一致 |
| `toSatisfy(predicate)` | predicateがtrueを返す |

<!-- example: docs/examples/matchers.test.ts#result -->
```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
  e.result.toSatisfy(user => user.id.startsWith('u')),
])
```
出典: [docs/examples/matchers.test.ts](../examples/matchers.test.ts)

toMatchObjectの期待値型は `Partial<V>` です。ネストした値の型まで再帰的なPartialにはしません。
predicateには実際の結果を渡し、真偽値を同期的に返すことを要求します。

## error

errorを含む配列は、対象がthrowまたはrejectすることを期待します。
例外の値はunknownです。

| マッチャ | 意味 |
|---|---|
| `toBeInstanceOf(ctor)` | instanceof ctor |
| `toThrow(message)` | Error.messageが文字列を含む、または正規表現に一致 |
| `toMatchObject(partial)` | 例外オブジェクトの指定プロパティが部分一致 |
| `toSatisfy(predicate)` | unknownを受けるpredicateがtrueを返す |

<!-- example: docs/examples/matchers.test.ts#error -->
```ts
.expect(e => [
  e.error.toBeInstanceOf(Error),
  e.error.toThrow('save failed'),
])
.expectCalls(call => [
  call(mailService, 'send').notCalled(),
])
```
出典: [docs/examples/matchers.test.ts](../examples/matchers.test.ts)

toThrowはErrorでない値には一致しません。文字列やundefinedをthrowする対象にはtoSatisfyを使えます。
RegExpのlastIndexを検証結果へ影響させず、検証後も元の値を変更しません。
resultとerrorを同じ配列へ入れることは型で防ぎます。

## 呼び出し

| マッチャ | 意味 |
|---|---|
| `calledTimes(n)` | 合計n回呼ばれた |
| `notCalled()` | 一度も呼ばれていない |
| `calledWith(...args)` | 深く一致する引数の呼び出しが1回以上ある |
| `calledOnceWith(...args)` | 合計1回だけ呼ばれ、その引数が深く一致する |
| `calledNthWith(n, ...args)` | そのメソッドのn回目の引数が深く一致する |

<!-- example: docs/examples/matchers.test.ts#calls -->
```ts
.expectCalls(call => [
  call(userRepository, 'save').calledOnceWith({ name: 'Alice' }),
])
```
出典: [docs/examples/matchers.test.ts](../examples/matchers.test.ts)

expectCallsだけでも正常終了を期待します。途中で予期しない例外が起きれば失敗です。
記録は実行器が自動設定し、mockがなければ本物のメソッドを呼びます。
同じメソッドへの複数条件は同じ呼び出し記録に対して検証します。
calledTimesは0以上の安全な整数を受け取り、それ以外は不正な期待として失敗します。
calledNthWithのnは1始まりの正の安全な整数で、定義時・実行受付時に検査します。
回数は呼び出し開始順で数え、Promiseの完了順ではありません。n回目がなければ失敗し、実際の合計回数を表示します。
calledNthWithは合計回数を制約しないため、必要ならcalledTimesを併記します。
引数は記録時の参照を保持し、深く複製しません。テスト対象が後から値を変更した場合は検証時の状態を比較します。

## middlewareで生成した参照・値を検証する

`call.from(ctx => ctx.client, 'send')` で、middlewareが作ったオブジェクトのメソッドを記録できます。
期待する引数には `calledWithFrom(build)`、`calledOnceWithFrom(build)`、`calledNthWithFrom(n, build)` を使えます。
`build` は型付きのctxから引数タプルを返します。静的な `call(obj, key)` とも組み合わせられます。

<!-- example: docs/examples/context-calls.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'

interface Client {
  send(id: string): Promise<void>
}

registerTest(new Test()
  .use(middleware(async (_, next) => {
    const client: Client = { async send(_id) {} }
    return next({ client, id: 'created-user' })
  }))
  .target((client: Client, id: string) => client.send(id))
  .it('準備したclientが生成したIDで呼ばれる', t => t
    .argsFrom(ctx => [ctx.client, ctx.id])
    .expectCalls(call => [
      call.from(ctx => ctx.client, 'send')
        .calledOnceWithFrom(ctx => [ctx.id]),
    ])))
```
出典: [docs/examples/context-calls.test.ts](../examples/context-calls.test.ts)

参照と期待引数のresolverは、各attemptのmiddleware前処理後、記録設定・argsFrom・targetの前に同期的に一度評価します。
retryでは新しいctxで評価し直し、skip/todoでは呼びません。resolverの例外はinstrumentationの失敗になり、targetを呼ばずmiddlewareの後始末へ進みます。
期待引数が参照する値は深く複製しません。対象による後続の変更は、静的な呼び出し条件と同様に検証時に見えます。

`call.from` は各attemptで得る通常オブジェクト向けです。module namespaceはCLIが読込前に準備するため、
`call(namespace, key).calledOnceWithFrom(...)` のように参照を静的に渡し、期待引数だけをctxから取得します。

## コンテキスト

<!-- example: docs/examples/matchers.test.ts#context -->
```ts
const withContext = new Test()
  .target(add)
  .use(middleware(async (_, next) => next({ input: [1, 2] as const, expected: 3 })))
  .it('ctxを使う', t => t
    .argsFrom(ctx => [...ctx.input])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```
出典: [docs/examples/matchers.test.ts](../examples/matchers.test.ts)

コンテキストには親から子までのmiddlewareがnextへ渡したフィールドが入り、同名のものは内側を優先します。
フィールド自体は読み取り専用ですが、参照先は同じ値なので、対象が変更したオブジェクトの状態も見えます。
expectのコールバックはテスト対象の呼び出しが終わった後に呼ぶため、コールバックで参照した値もその時点の値です。
predicateもコンテキストをクロージャで参照できます。追加のラベルや専用マッチャは不要です。

## 深い一致と評価

toEqualと呼び出し引数の比較は、Vitest 5.0.2のtoEqualと同じ比較関数を使います。
toMatchObjectも同バージョンの部分一致の比較関数を使います。JSONへのserializeは比較に使いません。
比較基準は固定した `@vitest/expect` のバージョンに対応し、更新時は互換性を検証します。

toEqualでは列挙可能なSymbolキーも比較します。同じSymbolのキーと値が一致すれば成功し、
同じ説明文から別々に生成したSymbolは別のキーとして扱います。
配列の穴とundefined、通常の欠けた文字列キーとundefinedのキーは区別しません。
同じプロパティを持つクラスインスタンスと通常オブジェクトも一致できます。
Dateは時刻、RegExpはsourceとflags、Map/Setは順序によらない内容の比較を行います。

toMatchObjectでは指定した文字列キーが存在することを要求し、その値を部分一致で比較します。
Dateは時刻を比較し、Map/Setは要素数と内容を比較します。Mapの値やSetの要素がオブジェクトなら部分一致になります。
配列は長さが一致したうえで要素ごとに部分一致します。
Vitest 5.0.2の挙動に合わせ、Symbolキーだけの条件は一致判定を制約しません。
RegExp・WeakMap・Promise等の列挙プロパティを持たないオブジェクトも、toMatchObjectでは別の値と一致する場合があります。
正規表現のパターンやフラグにはtoEqual、参照の同一性にはtoBe、Promiseの解決値にはawait後の値の検証を使います。

比較ではgetterが実行される場合があり、その例外は検証失敗として報告します。
診断を組み立てるためにgetterやtoJSONを実行しない規則は維持します。
この互換性は値の比較基準についてのものであり、Vitestの全マッチャ・カスタム比較関数登録・実行APIの提供を意味しません。

結果の期待、呼び出しの期待の順に、それぞれ配列順で評価し、最初の不一致で打ち切りません。
終了の種類が合わない場合、対応するresult/errorの述語は呼ばず、呼び出しの検証は続けます。
コールバックのthrowや述語のthrowも失敗として報告します。
不一致と述語のthrowを区別し、条件ごとの診断を[実行結果](results.md)へ残します。
blueprint上の表現は[プラグイン向けblueprint](metadata.md)、実行手順は[実行セマンティクス](../concepts/semantics.md)を参照してください。
