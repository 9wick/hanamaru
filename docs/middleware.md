# middlewareでケースを囲む

`.use(m)` は、各ケースの実行を囲むmiddlewareを登録します。
資源の取得と解放を同じスコープに書き、`next({ db })` で後続へ値を渡せます。

```ts
import { Test, middleware } from 'hanamaru'
import { createDatabase, countUsers } from './database.ts'

export const userCount = new Test()
  .use(middleware(async (_, next) => {
    const db = await createDatabase()
    try {
      return await next({ db, expected: 3 })
    } finally {
      await db.close()
    }
  }))
  .target(countUsers)
  .it('ユーザー数を取得する', t => t
    .argsFrom(ctx => [ctx.db])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

[この例](./examples/middleware.test.ts)の[サンプルDB](./examples/database.ts)は、3件のユーザーを持つメモリ上の実装です。
各試行で開き、期待の検証とモックの復元が終わってからcloseします。
ケースが失敗してもfinallyを通ります。

## middlewareを作る

middlewareは `middleware(fn, options?)` で作ります。
`.use(m)` と `.group(m, child)` はこの値だけを受け取り、関数をそのまま渡すと型エラーです。
fnは `(ctx, next) => ...`、optionsは `{ timeout }` です。

`.use()` / `.group()` の引数にそのまま書いた場合、ctxの型は書いた場所から決まります。注釈は不要です。

変数へ入れて複数の場所で使い回す場合だけ、必要なctxを引数の型に書きます。
その型を供給できるかは、使う場所の `.use()` / `.group()` で検査します。

```ts
const withExpected = middleware(async (ctx: { seed: number }, next) =>
  next({ expected: ctx.seed + 1 }))
```

## ctxの型はnextから伝わる

`next({ db, expected: 3 })` が返す完了値をmiddlewareから返すことで、後続のctxにdbとexpectedの型が伝わります。
型パラメータや型アサーションは不要です。次のmiddleware、argsFrom、e.ctxでも同じ型を使えます。
`await next(...)` だけでreturnを忘れた場合は型エラーです。

追加する値がなければ `return await next()` と書けます。
既存のフィールドは引き継ぎ、同名のフィールドだけ後の値・型で置き換えます。
middlewareの引数ctxは呼び出し時点の値のままです。後処理では上のdbのようにローカル変数を使えます。

## 値を渡すだけのmiddleware

値を渡すだけなら、nextの前後に処理を書きません。

```ts
.use(middleware(async (_, next) => next({ a: 1, expected: 3 })))
```

ケースへ値を渡す手段はmiddlewareだけです。
複数のmiddlewareは書いた順に実行します。グループでは親から子へ進み、後処理は逆順です。
どれも定義時には実行せず、実行する各ケースの各試行で呼びます。
共通設定なので、最初のケース・groupより前に登録します。

## nextを囲む処理

nextは、呼び出した非同期コンテキスト内で後続を実行します。
AsyncLocalStorageやコールバック型トランザクションも、同じ形でケースを囲めます。

```ts
.use(middleware(async (_, next) => {
  return await storage.run({ requestId: 'test' }, async () => {
    return await next()
  })
}))
```

finallyで片付ける場合は `return await next(...)` と書きます。
`return next(...)` だけでは下流の完了を待つ前にfinallyが動きます。
型が合っていても、awaitの位置やnextの呼び出し回数までは型で保証できません。

nextは1回呼び、その完了値を返します。未呼び出し・複数回・完了前のmiddleware終了は実行時の失敗です。
下流のケースが失敗すればnextはrejectし、外側のfinallyへ戻ります。
期待どおりのtargetの例外は成功として扱います。nextの失敗をcatchしてもテストの失敗は取り消しません。
詳細は[実行セマンティクス](./semantics.md)を参照してください。

## 前処理期限・後処理期限

前処理はmiddlewareが呼ばれてからnextを呼ぶまで、後処理はnextが完了してからmiddlewareが完了するまでです。
nextの中で配下（`.use()` ではケース、`.group()` ではchild）を実行している時間は、どちらにも含めません。

```ts
.use(middleware(async (_, next) => {
  const db = await createDatabase()
  try {
    return await next({ db })
  } finally {
    await db.close()
  }
}, { timeout: 30_000 }))
```

`timeout` の一つの値を、前処理と後処理のそれぞれへ独立に適用します。
既定値は10,000msで、`.use()` と `.group()` のどちらで使っても同じです。
単位はミリ秒、正の有限値を指定し、0を無制限の意味にはしません。不正値は定義エラーで、実行計画を直接受け取る場合も受付時に検査します。
期限はmiddlewareの性質なので、その定義に書きます。groupや `.use()` の引数では指定せず、既定値を設定ファイルで変える機能も設けません。

`.use()` のmiddlewareには試行期限とmiddleware自身の期限の両方が効き、先に超えた方で失敗します。
`.group()` のmiddlewareはどの試行にも含まれないため、効くのはmiddleware自身の期限だけです。

超過したときの扱いは試行期限と同じです。後続を開始せずそのrunを中断し、runはfailed / timeoutになります。
`.group()` の前処理が超過した場合はchild配下の実行対象ケースをcancelledにし、後処理が超過した場合は既存のchildの結果を保持したまま後続を中断します。
`.use()` のmiddlewareの超過は、その試行をfailed / timeoutとして試行期限の超過と同じに扱い、再試行しません。
結果には期限と、前処理・後処理のどちらで超えたかを残します。
同一プロセスの `run(plan)` が任意コードを強制停止できないことと、標準CLIのshutdownGraceは、試行期限と同じく当てはまります。

## 再試行

retryでは各試行で新しいctxからmiddlewareを実行し直します。前の試行の復元と後処理が成功した場合だけ再試行します。
試行期限は前処理から後処理までを含みます。標準CLIの強制終了ではfinallyの完了を保証できません。
未完了の処理を次のケースへ持ち越さないことと、ライブラリrunでの制約は[timeoutとretry](./execution-options.md)を参照してください。
