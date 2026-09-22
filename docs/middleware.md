# middlewareで準備と後始末を書く

`.use('perAttempt', ...)` は、各ケースの実行を囲むmiddlewareを登録します。
資源の取得と解放を同じスコープに書き、`next({ db })` で後続へ値を渡せます。

```ts
import { Test } from 'hanamaru'
import { createDatabase, countUsers } from './database.ts'

export const userCount = new Test()
  .use('perAttempt', async (_, next) => {
    const db = await createDatabase()
    try {
      return await next({ db, expected: 3 })
    } finally {
      await db.close()
    }
  })
  .target(countUsers)
  .it('ユーザー数を取得する', t => t
    .argsFrom(ctx => [ctx.db])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

[この例](./examples/middleware.test.ts)の[サンプルDB](./examples/database.ts)は、3件のユーザーを持つメモリ上の実装です。
各試行で開き、期待の検証とモックの復元が終わってからcloseします。
ケースが失敗してもfinallyを通ります。

## lifetimeを名前で表す

middlewareは資源のlifetimeをAPI上で明示します。

| scope | lifetime |
|---|---|
| `perAttempt` | retryを含む各caseの各試行ごとにsetupし、その試行の終了時にcleanupする |

将来の共有fixtureでは `perGroup`、実行processごとの `perProcess`、run全体の `perRun` を同じ `.use(scope, ...)` の形で追加できる設計を想定しますが、初版の公開APIには含めません。
共有fixtureはsetup costを共有するためのlifetimeであり、case間の順序依存を許す仕組みではありません。
順序依存が必要な一連の操作はflowの責務として分離します。

## ctxの型はnextから伝わる

`next({ db, expected: 3 })` が返す完了値をmiddlewareから返すことで、後続のctxにdbとexpectedの型が伝わります。
型パラメータや型アサーションは不要です。次のsetup・use、argsFrom、e.ctxでも同じ型を使えます。
`await next(...)` だけでreturnを忘れた場合は型エラーです。

追加する値がなければ `return await next()` と書けます。
既存のフィールドは引き継ぎ、同名のフィールドだけ後の値・型で置き換えます。
middlewareの引数ctxは呼び出し時点の値のままです。後始末では上のdbのようにローカル変数を使えます。

## setupとの使い分け

値を用意するだけなら、setupで書けます。

```ts
.setup(async () => ({ a: 1, expected: 3 }))
```

後始末や実行を囲む処理が必要ならuseを使います。setupにdispose引数はありません。
setupとuseは書いた順に実行します。グループでは親から子へ進み、useの後処理は逆順です。
どちらも定義時には実行せず、実行する各ケースの各試行で呼びます。
共通設定なので、最初のケース・groupより前に登録します。

## nextを囲む処理

nextは、呼び出した非同期コンテキスト内で後続を実行します。
AsyncLocalStorageやコールバック型トランザクションも、同じ形でケースを囲めます。

```ts
.use('perAttempt', async (_, next) => {
  return await storage.run({ requestId: 'test' }, async () => {
    return await next()
  })
})
```

finallyで片付ける場合は `return await next(...)` と書きます。
`return next(...)` だけでは下流の完了を待つ前にfinallyが動きます。
型が合っていても、awaitの位置やnextの呼び出し回数までは型で保証できません。

nextは1回呼び、その完了値を返します。未呼び出し・複数回・完了前のmiddleware終了は実行時の失敗です。
下流のケースが失敗すればnextはrejectし、外側のfinallyへ戻ります。
期待どおりのtargetの例外は成功として扱います。nextの失敗をcatchしてもテストの失敗は取り消しません。
詳細は[実行セマンティクス](./semantics.md)を参照してください。

## 再試行と期限

retryでは各試行で新しいctxから準備し、useも毎回実行します。前の試行の後始末が成功した場合だけ再試行します。
設定したtimeoutは前処理から後処理までを含みます。標準CLIの強制終了ではfinallyの完了を保証できません。
未完了の処理を次のケースへ持ち越さないことと、ライブラリrunでの制約は[timeoutとretry](./execution-options.md)を参照してください。
