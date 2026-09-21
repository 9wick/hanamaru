# マッチャ

`.expect(e => [...])` に戻り値・例外の条件を、`.expectCalls(call => [...])` に呼び出しの条件を並べます。
`e.result`、`e.error`、`call(obj, key)` は記述子を作る入口で、`e.ctx` はsetupが返した値です。

## result

resultの期待値は、対象の `Awaited<ReturnType<F>>` から型推論します。
同期・非同期で書き方を変える必要はありません。

| マッチャ | 意味 |
|---|---|
| `toBe(value)` | Object.isで一致 |
| `toEqual(value)` | 深い一致 |
| `toMatchObject(partial)` | 指定したプロパティが部分一致 |
| `toSatisfy(predicate)` | predicateがtrueを返す |

```ts
.expect(e => [
  e.result.toEqual({ id: 'u1' }),
  e.result.toSatisfy(user => user.id.startsWith('u')),
])
```

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

```ts
.expect(e => [
  e.error.toBeInstanceOf(Error),
  e.error.toThrow('save failed'),
])
.expectCalls(call => [
  call(mailService, 'send').notCalled(),
])
```

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

```ts
.expectCalls(call => [
  call(userRepository, 'save').calledOnceWith({ name: 'Alice' }),
])
```

expectCallsだけでも正常終了を期待します。途中で予期しない例外が起きれば失敗です。
記録は実行器が自動設定し、mockがなければ本物のメソッドを呼びます。
同じメソッドへの複数条件は同じ呼び出し記録に対して検証します。
calledTimesは0以上の安全な整数を受け取り、それ以外は不正な期待として失敗します。
引数は記録時の参照を保持し、深く複製しません。targetが後から値を変更した場合は検証時の状態を比較します。

## ctx

```ts
new Test()
  .target(add)
  .setup(() => ({ input: [1, 2] as const, expected: 3 }))
  .it('ctxを使う', t => t
    .argsFrom(ctx => [...ctx.input])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

ctxにはsetupが返した値がそのまま入ります。対象が変更した状態も見えます。
expectのコールバックはtarget終了後に呼ぶため、コールバックで参照した値もその時点の値です。
predicateもctxをクロージャで参照できます。追加のラベルや専用マッチャは不要です。

## 深い一致と評価

toEqualと呼び出し引数の比較では、プリミティブはObject.is、配列は長さと要素、通常オブジェクトはown enumerableなキーと値を比較します。
Symbolキーも含め、配列の穴とundefined、欠けたキーとundefinedのキーを区別します。
Dateは時刻、RegExpはsourceとflags、Map/Setは順序によらない深い一致で比較します。
クラスインスタンスは同じprototypeと列挙プロパティ、関数・Promise・WeakMap/WeakSetは参照一致とします。
循環参照では無限再帰せず、Errorはname・message・causeと列挙プロパティを比較し、stackは比較しません。
toMatchObjectでは指定したキーが存在することを要求し、その値を比較します。
これらは実装・検証対象の契約であり、Vitest/Jestの全マッチャとの互換性を意味しません。

結果の期待、呼び出しの期待の順に、それぞれ配列順で評価し、最初の不一致で打ち切りません。
終了の種類が合わない場合、対応するresult/errorの述語は呼ばず、呼び出しの検証は続けます。
コールバックのthrowや述語のthrowも失敗として報告します。
計画上の表現は[metadata](./metadata.md)、実行手順は[実行セマンティクス](./semantics.md)を参照してください。
